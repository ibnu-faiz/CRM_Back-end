import { Request, Response } from 'express';
import prisma from '../config/database';
import { ActivityType } from '@prisma/client';
import fs from 'fs/promises';
import path from 'path';
import { sendCRMEmail } from '../utils/email';
import { generateInvoiceNumber } from '../utils/invoiceGenerator';
import { sendNotification } from '../utils/notification';
import { deleteFileFromCloudinary } from '../utils/cloudinary';

const formatStatus = (status: string) => {
  if (!status) return "";
  return status
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

// 🔹 GET /api/leads
export const getAllLeads = async (req: Request, res: Response): Promise<void> => {
  try {
    const { status, search } = req.query;
    const where: any = {};

    if (status) where.status = status;
    if (search) {
      where.OR = [
        { title: { contains: search as string, mode: 'insensitive' } },
        { company: { contains: search as string, mode: 'insensitive' } },
      ];
    }

    // --- PERBAIKAN: Filter untuk SALES sekarang menggunakan relasi 'assignedUsers'
    if (req.user?.role === 'SALES') {
      where.assignedUsers = {
        some: { // 'some' berarti 'minimal ada satu' user yang cocok
          id: req.user.userId,
        },
      };
    }

    const leads = await prisma.lead.findMany({
      where,
      include: {
        // --- PERBAIKAN: Menggunakan 'assignedUsers' bukan 'assignedTo'
        assignedUsers: { select: { id: true, name: true, email: true, avatar: true } },
        createdBy: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.status(200).json({ leads, total: leads.length });
  } catch (error) {
    console.error('Get leads error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// 🔹 GET /api/leads/:id
export const getLeadById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const lead = await prisma.lead.findUnique({
      where: { id },
      include: {
        // --- PERBAIKAN: Menggunakan 'assignedUsers'
        assignedUsers: { select: { id: true, name: true, email: true, phone: true, avatar: true } },
        createdBy: { select: { id: true, name: true, email: true } },
      },
    });

    if (!lead) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }

    // --- PERBAIKAN: Logika otorisasi untuk SALES (Admin akan lolos)
    if (
      req.user?.role === 'SALES' && 
      !lead.assignedUsers.some(user => user.id === req.user?.userId)
    ) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    res.status(200).json({ lead });
  } catch (error) {
    console.error('Get lead by ID error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};


// 🔹 POST /api/leads
export const createLead = async (req: Request, res: Response): Promise<void> => {
  try {
    // --- PERBAIKAN: Pisahkan 'assignedUserIds' (array) dari 'leadData'
    const { assignedUserIds, ...leadData } = req.body;
    const { title } = leadData;

    if (!title) {
      res.status(400).json({ error: 'Title is required' });
      return;
    }

    const lead = await prisma.lead.create({
      data: {
        ...leadData, // Masukkan semua data lain (title, company, dll.)
        value: leadData.value ? parseFloat(leadData.value) : 0,
        currency: leadData.currency || 'IDR',
        status: leadData.status || 'LEAD_IN',
        priority: leadData.priority || 'MEDIUM',
        dueDate: leadData.dueDate ? new Date(leadData.dueDate) : null,
        createdById: req.user!.userId,
        // --- PERBAIKAN: Hubungkan array user menggunakan 'connect'
        assignedUsers: assignedUserIds ? {
          connect: (assignedUserIds as string[]).map(id => ({ id: id }))
        } : undefined,
      },
      include: {
        // --- PERBAIKAN: Menggunakan 'assignedUsers'
        assignedUsers: { select: { id: true, name: true, email: true, avatar: true } },
        createdBy: { select: { id: true, name: true, email: true } },
      },
    });

   if (lead.assignedUsers && lead.assignedUsers.length > 0) {
      for (const user of lead.assignedUsers) {
        await sendNotification(user.id, "notifyLeadAssign", {
          title: "New Lead Assigned",
          message: `You have been assigned to lead: ${lead.title} (${lead.company || 'No Company'})`,
          link: `/leads/${lead.id}`,
          type: "INFO"
        });
      }
    }

    // SKENARIO B: Lead Masuk tapi Belum Ada Sales (notifyNewLead - Khusus Admin)
    if (!lead.assignedUsers || lead.assignedUsers.length === 0) {
      const admins = await prisma.user.findMany({ where: { role: 'ADMIN' }, select: { id: true } });
      for (const admin of admins) {
        await sendNotification(admin.id, "notifyNewLead", {
          title: "New Unassigned Lead",
          message: `New lead "${lead.title}" created without sales assignment.`,
          link: `/leads/${lead.id}`,
          type: "WARNING"
        });
      }
    }
    // ============================================================
    // SELESAI INTEGRASI NOTIFIKASI
    // ============================================================

    res.status(201).json({ lead, message: 'Lead created successfully' });
  } catch (error) {
    console.error('Create lead error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// 🔹 PUT /api/leads/:id (atau PATCH)
export const updateLead = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { assignedUserIds, ...updateData } = req.body;

    // 1. Ambil Data Lama (Untuk perbandingan status lama vs baru)
    const existingLead = await prisma.lead.findUnique({ 
      where: { id },
      include: { assignedUsers: { select: { id: true } } } 
    });

    if (!existingLead) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }

    // 2. Cek Otorisasi (Sales cuma boleh edit lead sendiri)
    if (
      req.user?.role === 'SALES' && 
      !existingLead.assignedUsers.some(user => user.id === req.user?.userId)
    ) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    // 3. Set Tanggal Won/Lost Otomatis
    if (updateData.status === 'WON' && existingLead.status !== 'WON') {
      updateData.wonAt = new Date();
    } else if (updateData.status === 'LOST' && existingLead.status !== 'LOST') {
      updateData.lostAt = new Date();
    }

    // 4. Lakukan Update ke Database
    const lead = await prisma.lead.update({
      where: { id },
      data: {
        ...updateData,
        dueDate: updateData.dueDate ? new Date(updateData.dueDate) : undefined,
        assignedUsers: assignedUserIds ? {
          set: (assignedUserIds as string[]).map(id => ({ id: id }))
        } : undefined 
      },
      include: {
        assignedUsers: { select: { id: true, name: true, email: true, avatar: true } },
      },
    });

    // ============================================================
    // MULAI INTEGRASI NOTIFIKASI UPDATE
    // ============================================================

    // SKENARIO A: Re-assignment (Admin mengubah petugas Sales)
    // Kita cek apakah ada request 'assignedUserIds' yg dikirim
    if (assignedUserIds && lead.assignedUsers.length > 0) {
       for (const user of lead.assignedUsers) {
         // Cek logic user baru/lama jika perlu, atau kirim ke semua sales aktif
         await sendNotification(user.id, "notifyLeadAssign", {
            title: "Lead Assignment Update",
            message: `You are now assigned to handle "${lead.title}".`,
            link: `/leads/${lead.id}`,
            type: "INFO"
         });
       }
    }

    // SKENARIO B: Status Berubah (Penting!)
    if (updateData.status && updateData.status !== existingLead.status) {
        const newStatus = updateData.status;

        // A. Notify Admin (Hanya jika Deal WON atau LOST)
        if (newStatus === 'WON' || newStatus === 'LOST') {
            const admins = await prisma.user.findMany({ where: { role: 'ADMIN' }, select: { id: true }});
            // Gunakan 'SUCCESS' untuk Won, 'ERROR' (Merah) untuk Lost
            const type = newStatus === 'WON' ? 'SUCCESS' : 'ERROR'; 
            
            for (const admin of admins) {
                await sendNotification(admin.id, "notifyDealStatus", {
                    title: `Deal ${newStatus === 'WON' ? 'Won! 🎉' : 'Lost 📉'}`,
                    // Pakai formatStatus disini
                    message: `Lead "${lead.title}" has been marked as ${formatStatus(newStatus)}.`,
                    link: `/leads/${lead.id}`,
                    type: type
                });
            }
        }

        // B2. Jika ADMIN yang mengubah status -> Beritahu Sales (Supaya sales tau update dari atasan)
        if (req.user?.role === 'ADMIN' && lead.assignedUsers.length > 0) {
             
             // [BARU] Ubah status jadi kalimat rapi
             const readableStatus = formatStatus(newStatus); 

             for (const user of lead.assignedUsers) {
                await sendNotification(user.id, "notifyLeadUpdate", {
                    title: "Status Updated",
                    // Pesan jadi: "Admin updated status of "PT ABC" to Contact Made."
                    message: `Admin updated status of "${lead.title}" to ${readableStatus}.`,
                    link: `/leads/${lead.id}`,
                    type: "WARNING"
                });
             }
        }
    }

    // ============================================================
    // SELESAI INTEGRASI NOTIFIKASI
    // ============================================================

    res.status(200).json({ lead, message: 'Lead updated successfully' });
  } catch (error) {
    console.error('Update lead error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// 🔹 DELETE /api/leads/:id
export const deleteLead = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    // @ts-ignore
    const userId = req.user?.userId;
    // @ts-ignore
    const userRole = req.user?.role;

    // 1. Cari dulu Lead-nya
    const lead = await prisma.lead.findUnique({ where: { id } });

    if (!lead) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }

    // 2. 🔥 LOGIC BARU: Izinkan jika dia ADMIN --ATAU-- dia CREATOR
    const isCreator = lead.createdById === userId;
    const isAdmin = userRole === 'ADMIN';

    if (!isCreator && !isAdmin) {
      // Ini pesan yang nanti akan muncul di Toast Frontend
      res.status(403).json({ error: 'Permission denied. Only the creator or Admin can delete this lead.' });
      return;
    }

    // 3. Hapus
    await prisma.lead.delete({ where: { id } });
    res.status(200).json({ message: 'Lead deleted successfully' });

  } catch (error) {
    console.error('Delete lead error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// 🔹 GET /api/leads/by-status
// src/controllers/leads.controller.ts

export const getLeadsByStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user?.userId;
    const userRole = (req as any).user?.role;
    
    // 1. Ambil parameter dari URL (contoh: ?archived=true)
    const isArchivedQuery = req.query.archived === 'true'; 

    // 2. Setup Filter Dasar
    const whereCondition: any = {
       // Jika ?archived=true -> Cari yang isArchived = true
       // Jika ?archived=false -> Cari yang isArchived = false (Active)
       isArchived: isArchivedQuery ? true : false 
    };

    // 3. Filter Tambahan untuk Sales (Hanya lihat milik sendiri)
    if (userRole === 'SALES') {
      whereCondition.AND = [
        {
             OR: [
                { createdById: userId },
                { assignedUsers: { some: { id: userId } } }
             ]
        }
      ];
    }

    // 4. Eksekusi Query
    const leads = await prisma.lead.findMany({
      where: whereCondition, 
      include: {
        assignedUsers: { select: { id: true, name: true, avatar: true } },
        createdBy: { select: { id: true, name: true } }
      },
      orderBy: { updatedAt: 'desc' },
    });

    // ... (Logika Grouping & Stats di bawah TETAP SAMA) ...
    
    const grouped: Record<string, any[]> = { /* ... seperti sebelumnya ... */ };
    const statsMap: Record<string, any> = {};

    leads.forEach((lead) => {
        // ... (kode grouping Anda) ...
        const status = lead.status;
        if (!grouped[status]) grouped[status] = [];
        grouped[status].push(lead);
        
        if (!statsMap[status]) statsMap[status] = { count: 0, totalValue: 0 };
        statsMap[status].count += 1;
        statsMap[status].totalValue += lead.value;
    });

    const stats = Object.keys(statsMap).map((key) => ({
      status: key,
      ...statsMap[key],
    }));

    res.status(200).json({ grouped, stats });

  } catch (error) {
    console.error('Get leads error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Mengambil SEMUA aktivitas untuk satu lead (untuk Timeline)
 */
export const getLeadActivities = async (req: Request, res: Response) => {
  const { leadId } = req.params;
  try {
    const activities = await prisma.leadActivity.findMany({
      where: { leadId },
      orderBy: { createdAt: 'desc' },
      include: {
        createdBy: { select: { id: true, name: true, avatar: true } },
      },
    });
    res.status(200).json(activities);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch activities' });
  }
};

/**
 * Mengambil NOTES saja untuk satu lead (untuk tab Notes)
 */
export const getLeadNotes = async (req: Request, res: Response) => {
  const { leadId } = req.params;
  try {
    const notes = await prisma.leadActivity.findMany({
      where: {
        leadId,
        type: ActivityType.NOTE, // Hanya ambil tipe NOTE
      },
      orderBy: { createdAt: 'desc' },
      include: {
        createdBy: { select: { id: true, name: true, avatar: true } },
      },
    });
    res.status(200).json(notes);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch notes' });
  }
};

/**
 * Membuat NOTE baru
 */
export const createLeadNote = async (req: Request, res: Response) => {
  const { leadId } = req.params;
  
  // Ambil data dari body
  let { content, title, meta: metaString } = req.body; 
  const file = req.file; 
  const userId = (req as any).user?.userId;

  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  if (!content) return res.status(400).json({ error: 'Content is required' });
  
  // A. Parse Meta (Karena FormData mengirim object sebagai string)
  let meta: any = {};
  if (metaString) {
    try {
      meta = typeof metaString === 'string' ? JSON.parse(metaString) : metaString;
    } catch (e) {
      meta = {}; 
    }
  }

  // B. Logic File Cloudinary
  // req.file.path SUDAH berupa URL lengkap (https://res.cloudinary...)
  if (file) {
    meta.attachmentUrl = file.path; 
    meta.attachmentName = file.originalname; // Simpan nama asli file untuk display
  }

  // Fallback title
  const finalTitle = title || meta.title || 'Note';

  try {
    const newNote = await prisma.leadActivity.create({
      data: {
        leadId: leadId,
        createdById: userId,
        type: ActivityType.NOTE,
        description: content,
        title: finalTitle, 
        meta: {
            ...meta,
            title: finalTitle 
        },
        scheduledAt: new Date() 
      },
      include: {
        createdBy: { select: { id: true, name: true, avatar: true } }
      }
    });
    res.status(201).json(newNote);
  } catch (error) {
    console.error("Create Note Error:", error);
    res.status(500).json({ error: 'Failed to create note' });
  }
};

/**
 * Membuat aktivitas baru (Call, Meeting, dll)
 */
export const createLeadActivity = async (req: Request, res: Response) => {
  const { leadId } = req.params;
  const { type, content, title, description, meta, scheduledAt, location, isCompleted, attendees } = req.body;
  
  const userId = (req as any).user?.userId;
  const userRole = (req as any).user?.role; // Ambil Role User

  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  
  if (!type || !Object.values(ActivityType).includes(type as ActivityType)) {
    return res.status(400).json({ error: 'Invalid activity type' });
  }

  const finalTitle = title || content;
  if (!finalTitle) return res.status(400).json({ error: 'Title required' });

  let finalDescription = description;
  if (!finalDescription && meta && meta.description) {
      finalDescription = meta.description;
  }

  try {
    const newActivity = await prisma.leadActivity.create({
      data: {
        leadId: leadId,
        createdById: userId,
        type: type as ActivityType,
        title: finalTitle,
        description: finalDescription || '',
        location: location || null,
        scheduledAt: scheduledAt ? new Date(scheduledAt) : new Date(),
        isCompleted: isCompleted || false,
        meta: meta,
        ...(attendees && Array.isArray(attendees) ? {
            attendees: {
                connect: attendees.map((id: string) => ({ id: id }))
            }
        } : {})
      },
      // [PERBAIKAN]: Include Lead & AssignedUsers untuk Notifikasi
      include: {
        lead: {
          include: {
            assignedUsers: { select: { id: true, name: true } }
          }
        },
        attendees: {
            select: { id: true, name: true, avatar: true, email: true }
        },
        createdBy: {
            select: { id: true, name: true, avatar: true }
        }
      }
    });

    // --- NOTIFICATION LOGIC ---
    // Jika ADMIN yang membuat Activity (Meeting/Call) -> Notif ke Sales
    if (userRole === 'ADMIN' && newActivity.lead?.assignedUsers) {
        
        const typeLabel = type === 'MEETING' ? 'Meeting' : 'Call';
        
        for (const sales of newActivity.lead.assignedUsers) {
            // Jangan notif diri sendiri
            if (sales.id !== userId) {
                await sendNotification(sales.id, "notifyActivity", {
                    title: `New ${typeLabel} Scheduled`,
                    message: `Admin scheduled a ${typeLabel.toLowerCase()} regarding "${newActivity.title}" on ${new Date(newActivity.scheduledAt).toLocaleDateString()}.`,
                    link: `/leads/${leadId}`,
                    type: "INFO"
                });
            }
        }
    }

    res.status(201).json(newActivity);
  } catch (error) {
    console.error("Create Activity Error:", error);
    res.status(500).json({ error: 'Failed to create activity' });
  }
};
// ... (setelah createLeadActivity)

/**
 * Mengambil SATU note berdasarkan ID
 */
export const getLeadNoteById = async (req: Request, res: Response) => {
  const { leadId, noteId } = req.params;
  const userId = (req as any).user?.userId;

  try {
    const note = await prisma.leadActivity.findFirst({
      where: { id: noteId, leadId: leadId, type: ActivityType.NOTE },
    });

    if (!note) {
      return res.status(404).json({ error: 'Note not found' });
    }

    // --- PERBAIKAN: Otorisasi untuk SALES
    const lead = await prisma.lead.findFirst({ 
      where: { id: leadId },
      include: { assignedUsers: { select: { id: true } } }
    });

    if (
      (req as any).user?.role === 'SALES' &&
      !lead?.assignedUsers.some(user => user.id === userId)
    ) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.status(200).json(note);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch note' });
  }
};

/**
 * Meng-update NOTE
 */
export const updateLeadNote = async (req: Request, res: Response) => {
  const { leadId, noteId } = req.params;
  const { content, title, removeAttachment } = req.body; 
  const file = req.file;
  const userId = (req as any).user?.userId;

  if (!content) return res.status(400).json({ error: 'Content is required' });

  try {
    const noteToUpdate = await prisma.leadActivity.findFirst({
      where: { id: noteId, leadId: leadId },
    });
    
    if (!noteToUpdate) return res.status(404).json({ error: 'Note not found' });
    
    // Cek Permission
    if (noteToUpdate.createdById !== userId && (req as any).user?.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    let meta = (noteToUpdate.meta as any) || {};

    // C. Logic Update File Cloudinary (SUDAH DIPERBAIKI)
    if (file) {
      // 1. 🔥 JIKA ADA FILE BARU, HAPUS YANG LAMA 🔥
      if (meta.attachmentUrl) {
          await deleteFileFromCloudinary(meta.attachmentUrl);
      }
      
      // 2. Simpan URL baru
      meta.attachmentUrl = file.path;
      meta.attachmentName = file.originalname;
    } 
    else if (removeAttachment === 'true' || removeAttachment === true) {
      // 3. 🔥 JIKA USER KLIK REMOVE, HAPUS FILE DI CLOUD 🔥
      if (meta.attachmentUrl) {
          await deleteFileFromCloudinary(meta.attachmentUrl);
      }
      // Hapus data di meta
      delete meta.attachmentUrl;
      delete meta.attachmentName;
    }

    // Update Title di Meta juga
    if (title) meta.title = title;

    const updatedNote = await prisma.leadActivity.update({
      where: { id: noteId },
      data: { 
        description: content,
        title: title || noteToUpdate.title, 
        meta: meta, 
      },
      include: {
        createdBy: { select: { id: true, name: true, avatar: true } }
      }
    });

    res.status(200).json(updatedNote);
  } catch (error) {
    console.error("Update Note Error:", error);
    res.status(500).json({ error: 'Failed to update note' });
  }
};

/**
 * Menghapus NOTE
 */
export const deleteLeadNote = async (req: Request, res: Response) => {
  const { leadId, noteId } = req.params;
  const userId = (req as any).user?.userId;

  try {
    const noteToDelete = await prisma.leadActivity.findFirst({
      where: { id: noteId, leadId: leadId },
    });

    if (!noteToDelete) {
      return res.status(404).json({ error: 'Note not found' });
    }

    // Otorisasi: Hanya pembuat note atau Admin yang bisa delete
    if (noteToDelete.createdById !== userId && (req as any).user?.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Access denied to delete this note' });
    }

    // --- LOGIKA HAPUS FILE (VERSI CLOUDINARY) ---
    const meta = (noteToDelete.meta as any) || {};
    
    // 🔥 Cek apakah ada URL Cloudinary? Jika ada, HAPUS! 🔥
    if (meta.attachmentUrl) {
        await deleteFileFromCloudinary(meta.attachmentUrl);
    }

    // Hapus data di database
    await prisma.leadActivity.delete({
      where: { id: noteId },
    });

    res.status(200).json({ message: 'Note deleted successfully' });
  } catch (error) {
    console.error("Delete Note Error:", error);
    res.status(500).json({ error: 'Failed to delete note' });
  }
};

// ... (setelah deleteLeadNote)

/**
 * Mengambil SEMUA meetings untuk satu lead (untuk tab Meeting)
 */
export const getLeadMeetings = async (req: Request, res: Response) => {
  const { leadId } = req.params;
  try {
    const meetings = await prisma.leadActivity.findMany({
      where: {
        leadId,
        type: ActivityType.MEETING, 
      },
      orderBy: { createdAt: 'desc' },
      include: {
        createdBy: { 
            select: { id: true, name: true, avatar: true } 
        },
        // 👇 Include Attendees agar avatar muncul di List
        attendees: { 
            select: { id: true, name: true, avatar: true, email: true }
        }
      },
    });
    res.status(200).json(meetings);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch meetings' });
  }
};

/**
 * 2. GET SINGLE MEETING (Detail)
 */
export const getLeadMeetingById = async (req: Request, res: Response) => {
  const { leadId, meetingId } = req.params;
  try {
    const meeting = await prisma.leadActivity.findFirst({
      where: {
        id: meetingId,
        leadId: leadId,
        type: ActivityType.MEETING,
      },
      // 👇 TAMBAHKAN INI (Penting untuk view detail/modal edit)
      include: {
        createdBy: { select: { id: true, name: true, avatar: true } },
        attendees: { select: { id: true, name: true, avatar: true, email: true } }
      }
    });

    if (!meeting) {
      return res.status(404).json({ error: 'Meeting not found' });
    }
    
    res.status(200).json(meeting);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch meeting' });
  }
};

/**
 * 3. UPDATE MEETING
 */
export const updateLeadMeeting = async (req: Request, res: Response) => {
  const { leadId, meetingId } = req.params;
  
  // 👇 1. AMBIL 'attendees' DARI BODY
  const { content, title, meta, location, scheduledAt, description, attendees } = req.body; 
  
  const userId = (req as any).user?.userId;
  const finalTitle = title || content;

  if (!finalTitle) {
    return res.status(400).json({ error: 'Meeting title is required' });
  }

  try {
    const meetingToUpdate = await prisma.leadActivity.findFirst({
      where: { id: meetingId, leadId: leadId },
    });

    if (!meetingToUpdate) {
      return res.status(404).json({ error: 'Meeting not found' });
    }

    if (meetingToUpdate.createdById !== userId && (req as any).user?.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Access denied to update this meeting' });
    }

    let finalDescription = description;
    if (!finalDescription && meta && meta.description) {
        finalDescription = meta.description;
    }

    const updatedMeeting = await prisma.leadActivity.update({
      where: { id: meetingId },
      data: { 
        title: finalTitle,
        description: finalDescription || '',
        location: location,
        scheduledAt: scheduledAt ? new Date(scheduledAt) : undefined,
        meta: meta,

        // 👇 2. LOGIKA UPDATE ATTENDEES (Pakai 'set' untuk replace)
        ...(attendees && Array.isArray(attendees) ? {
            attendees: {
                set: attendees.map((id: string) => ({ id: id })) 
            }
        } : {})
      },
      // 👇 3. INCLUDE AGAR FRONTEND LANGSUNG UPDATE TANPA REFRESH
      include: {
          createdBy: { select: { id: true, name: true, avatar: true } },
          attendees: { select: { id: true, name: true, avatar: true } }
      }
    });

    res.status(200).json(updatedMeeting);
  } catch (error) {
    console.error("Update Meeting Error:", error);
    res.status(500).json({ error: 'Failed to update meeting' });
  }
};

/**
 * Menghapus MEETING
 */
export const deleteLeadMeeting = async (req: Request, res: Response) => {
  const { leadId, meetingId } = req.params;
  const userId = (req as any).user?.userId;

  try {
    const meetingToDelete = await prisma.leadActivity.findFirst({
      where: { id: meetingId, leadId: leadId },
    });

    if (!meetingToDelete) {
      return res.status(404).json({ error: 'Meeting not found' });
    }

    if (meetingToDelete.createdById !== userId && (req as any).user?.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Access denied to delete this meeting' });
    }

    await prisma.leadActivity.delete({
      where: { id: meetingId },
    });

    res.status(200).json({ message: 'Meeting deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete meeting' });
  }
};


/**
 * Mengambil SEMUA calls untuk satu lead (untuk tab Call)
 */
export const getLeadCalls = async (req: Request, res: Response) => {
  const { leadId } = req.params;
  try {
    const calls = await prisma.leadActivity.findMany({
      where: {
        leadId,
        type: ActivityType.CALL, // Hanya ambil tipe CALL
      },
      orderBy: { createdAt: 'desc' },
      include: {
        createdBy: { select: { id: true, name: true, avatar: true } },
      },
    });
    res.status(200).json(calls);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch calls' });
  }
};

/**
 * Mengambil SATU call berdasarkan ID
 */
export const getLeadCallById = async (req: Request, res: Response) => {
  const { leadId, callId } = req.params;
  try {
    const call = await prisma.leadActivity.findFirst({
      where: {
        id: callId,
        leadId: leadId,
        type: ActivityType.CALL,
      },
    });

    if (!call) {
      return res.status(404).json({ error: 'Call not found' });
    }
    res.status(200).json(call);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch call' });
  }
};

/**
 * Meng-update CALL
 */
export const updateLeadCall = async (req: Request, res: Response) => {
  const { leadId, callId } = req.params;
  
  // Destructure input lama ('content') dan input baru ('title', 'scheduledAt', dll)
  const { content, title, meta, description, scheduledAt } = req.body; 
  
  const userId = (req as any).user?.userId;

  // Logic Mapping: Gunakan 'title' jika ada, jika tidak gunakan 'content'
  const finalTitle = title || content;

  if (!finalTitle) {
    return res.status(400).json({ error: 'Call title is required' });
  }

  try {
    const callToUpdate = await prisma.leadActivity.findFirst({
      where: { id: callId, leadId: leadId },
    });

    if (!callToUpdate) {
      return res.status(404).json({ error: 'Call not found' });
    }

    if (callToUpdate.createdById !== userId && (req as any).user?.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Access denied to update this call' });
    }

    // Cek description (opsional, jaga-jaga kalau frontend kirim lewat meta)
    let finalDescription = description;
    if (!finalDescription && meta && meta.description) {
        finalDescription = meta.description;
    }

    const updatedCall = await prisma.leadActivity.update({
      where: { id: callId },
      data: { 
        // --- PERBAIKAN DISINI ---
        title: finalTitle,        // Mapping: 'content' masuk ke 'title'
        description: finalDescription || '', // Mapping description
        
        // Field tambahan (bisa diupdate jika frontend mengirimnya)
        scheduledAt: scheduledAt ? new Date(scheduledAt) : undefined,
        
        meta: meta, 
      },
    });

    res.status(200).json(updatedCall);
  } catch (error) {
    console.error("Update Call Error:", error);
    res.status(500).json({ error: 'Failed to update call' });
  }
};
/**
 * Menghapus CALL
 */
export const deleteLeadCall = async (req: Request, res: Response) => {
  const { leadId, callId } = req.params;
  const userId = (req as any).user?.userId;

  try {
    const callToDelete = await prisma.leadActivity.findFirst({
      where: { id: callId, leadId: leadId },
    });

    if (!callToDelete) {
      return res.status(404).json({ error: 'Call not found' });
    }

    if (callToDelete.createdById !== userId && (req as any).user?.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Access denied to delete this call' });
    }

    await prisma.leadActivity.delete({
      where: { id: callId },
    });

    res.status(200).json({ message: 'Call deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete call' });
  }
};

// --- 1. CREATE: Kirim Email & Simpan Log ---
export const sendLeadEmail = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { to, cc, bcc, subject, message, replyTo, isDraft } = req.body;
    
    const isDraftBool = isDraft === 'true' || isDraft === true;
    const file = req.file;
    const tokenUser = (req as any).user; 

    if (!tokenUser) return res.status(401).json({ message: "Unauthorized" });

    const userDetail = await prisma.user.findUnique({ where: { id: tokenUser.userId } });
    const senderName = userDetail?.name || "Team"; 
    const fromLabel = `${senderName} from CMLABS`;
    const finalReplyTo = replyTo ? replyTo : process.env.SMTP_EMAIL;

    // --- LOGIKA ATTACHMENT CLOUDINARY ---
    let emailAttachments: any[] = [];
    let savedAttachmentUrl = null;
    let savedAttachmentName = null;

    if (file) {
      // D. Simpan URL Cloudinary untuk Database
      savedAttachmentUrl = file.path;
      savedAttachmentName = file.originalname;

      // E. Siapkan Object Attachment untuk Nodemailer
      // Nodemailer pintar, kalau dikasih 'path' berupa URL https, dia akan download otomatis.
      emailAttachments.push({
        filename: file.originalname,
        path: file.path // 🔥 Pakai URL Cloudinary langsung!
      });
    }

    // --- KIRIM EMAIL (Jika bukan Draft) ---
    if (!isDraftBool) {
      await sendCRMEmail({
        to, cc, bcc, subject,
        html: message,
        senderName: senderName,
        replyTo: finalReplyTo,
        // @ts-ignore
        attachments: emailAttachments
      });
    }

    // --- SIMPAN KE DATABASE ---
    const newActivity = await prisma.leadActivity.create({
      data: {
        leadId: id,
        createdById: tokenUser.userId,
        type: ActivityType.EMAIL,
        title: subject,
        description: message || '', 
        
        meta: {
          status: isDraftBool ? 'DRAFT' : 'SENT',
          from: fromLabel,
          to, cc, bcc, replyTo: finalReplyTo,
          messageBody: message,
          attachmentUrl: savedAttachmentUrl, // Simpan URL Cloudinary
          attachmentName: savedAttachmentName
        }
      },
      include: {
        createdBy: { select: { id: true, name: true, avatar: true } }
      }
    });

    return res.status(200).json({ 
      success: true, 
      message: isDraftBool ? "Saved as Draft." : "Email sent.",
      data: newActivity 
    });

  } catch (error) {
    console.error("Controller Email Error:", error);
    return res.status(500).json({ 
      success: false, 
      message: error instanceof Error ? error.message : "Error processing email." 
    });
  }
};

// --- 2. READ: Ambil Semua Email ---
export const getLeadEmails = async (req: Request, res: Response) => {
  const { leadId } = req.params; 

  try {
    const emails = await prisma.leadActivity.findMany({
      where: {
        leadId: leadId,
        type: ActivityType.EMAIL, // Pakai Enum
      },
      orderBy: { createdAt: 'desc' },
      include: {
        createdBy: { select: { id: true, name: true, avatar: true } },
      },
    });
    res.status(200).json(emails);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch emails' });
  }
};

// --- 3. READ ONE: Ambil 1 Email Detail ---
export const getLeadEmailById = async (req: Request, res: Response) => {
  const { leadId, emailId } = req.params;

  try {
    const email = await prisma.leadActivity.findFirst({
      where: {
        id: emailId,
        leadId: leadId,
        type: ActivityType.EMAIL,
      },
    });

    if (!email) {
      return res.status(404).json({ error: 'Email not found' });
    }
    res.status(200).json(email);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch email' });
  }
};

// --- 4. UPDATE: Edit Log Email ---
export const updateLeadEmail = async (req: Request, res: Response) => {
  const { leadId, emailId } = req.params;
  const { to, cc, bcc, subject, message, replyTo, isDraft } = req.body; 
  const file = req.file;
  // @ts-ignore
  const userId = req.user?.userId;

  try {
    const emailToUpdate = await prisma.leadActivity.findFirst({
      where: { id: emailId, leadId: leadId },
    });

    if (!emailToUpdate) return res.status(404).json({ error: 'Email not found' });

    // @ts-ignore
    if (emailToUpdate.createdById !== userId && req.user?.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Access denied' });
    }

    let currentMeta = (emailToUpdate.meta as any) || {};
    
    // Setup Data Baru
    const newSubject = subject || emailToUpdate.title;
    const newMessage = message || currentMeta.messageBody;
    const newTo = to || currentMeta.to;
    const newCc = cc || currentMeta.cc;
    const newBcc = bcc || currentMeta.bcc;
    const newReplyTo = replyTo || currentMeta.replyTo;

    // --- LOGIKA FILE BARU (Cloudinary) ---
    if (file) {
      // 1. 🔥 HAPUS FILE LAMA JIKA ADA 🔥
      if (currentMeta.attachmentUrl) {
         await deleteFileFromCloudinary(currentMeta.attachmentUrl);
      }

      // 2. Simpan URL Baru
      currentMeta.attachmentUrl = file.path; 
      currentMeta.attachmentName = file.originalname;
    }

    // --- LOGIKA KIRIM DRAFT SEKARANG ---
    // Cek apakah status draft dan user minta kirim sekarang (isDraft = false)
    const isSendingNow = currentMeta.status === 'DRAFT' && (isDraft === 'false' || isDraft === false);

    if (isSendingNow) {
      console.log("🚀 Sending DRAFT email now...");
      const userDetail = await prisma.user.findUnique({ where: { id: userId } });
      const senderName = userDetail?.name || "Team"; 

      let attachments = [];
      
      // Ambil URL dari file baru ATAU URL dari database (Cloudinary Link)
      const urlToSend = file ? file.path : currentMeta.attachmentUrl;
      const nameToSend = file ? file.originalname : (currentMeta.attachmentName || "attachment");

      if (urlToSend) {
         // F. Nodemailer support kirim via URL
         attachments.push({ 
             filename: nameToSend, 
             path: urlToSend 
         });
      }

      await sendCRMEmail({
        to: newTo, cc: newCc, bcc: newBcc,
        subject: newSubject,
        html: newMessage,
        senderName: senderName,
        replyTo: newReplyTo,
        // @ts-ignore
        attachments: attachments
      });

      currentMeta.status = 'SENT';
    }

    // Update Meta
    currentMeta.to = newTo;
    currentMeta.cc = newCc;
    currentMeta.bcc = newBcc;
    currentMeta.messageBody = newMessage;
    currentMeta.replyTo = newReplyTo;

    const updatedEmail = await prisma.leadActivity.update({
      where: { id: emailId },
      data: { 
         title: newSubject,
         description: newMessage || '', 
         meta: currentMeta 
      },
      include: {
        createdBy: { select: { id: true, name: true, avatar: true } }
      }
    });
    
    res.status(200).json({ 
      success: true, 
      message: isSendingNow ? "Draft sent successfully." : "Draft updated.",
      data: updatedEmail
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update email' });
  }
};

// --- 5. DELETE: Hapus Log Email ---
export const deleteLeadEmail = async (req: Request, res: Response) => {
  const { leadId, emailId } = req.params;
  
  // @ts-ignore
  const userId = req.user?.userId;
  // @ts-ignore
  const userRole = req.user?.role;

  try {
    // 1. Cari dulu datanya
    const emailToDelete = await prisma.leadActivity.findFirst({
      where: { id: emailId, leadId: leadId },
    });

    if (!emailToDelete) {
      return res.status(404).json({ error: 'Email log not found' });
    }

    // 2. Cek Permission
    // @ts-ignore
    if (emailToDelete.createdById !== userId && userRole !== 'ADMIN') {
      return res.status(403).json({ error: 'Access denied' });
    }

    // 3. --- LOGIKA HAPUS FILE FISIK (Cloudinary) ---
    const meta = (emailToDelete.meta as any) || {};
    
    // 🔥 Cek attachmentUrl, lalu hapus via helper Cloudinary 🔥
    if (meta.attachmentUrl) {
        await deleteFileFromCloudinary(meta.attachmentUrl);
    }

    // 4. Hapus Record dari Database
    await prisma.leadActivity.delete({
      where: { id: emailId },
    });

    res.status(200).json({ message: 'Email log and attachment deleted successfully' });

  } catch (error) {
    console.error("Delete Error:", error);
    res.status(500).json({ error: 'Failed to delete email log' });
  }
};

/**
 * Membuat Invoice Baru dengan Auto-Number
 */
export const createLeadInvoice = async (req: Request, res: Response) => {
  try {
    const { leadId } = req.params;
    const sourceData = req.body.meta || req.body;

    const { 
      dueDate, items, notes, 
      billedBy, billedTo, 
      subtotal, tax, totalAmount, 
      status, invoiceDate 
    } = sourceData;
    
    // @ts-ignore
    const userId = req.user?.userId;
    // @ts-ignore
    const userName = req.user?.name || 'Sales'; // Ambil nama user untuk pesan notif

    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const invoiceNumber = await generateInvoiceNumber(); // Pastikan fungsi ini ada

    const newInvoice = await prisma.leadActivity.create({
      data: {
        leadId: leadId,
        createdById: userId,
        type: ActivityType.INVOICE, // Pastikan Enum ini ada
        title: invoiceNumber,
        description: 'Invoice',
        
        meta: {
          status: status || 'draft', 
          items: items || [],
          notes: notes || '',
          billedBy: billedBy || '',
          billedTo: billedTo || '',
          subtotal: subtotal || 0,
          tax: tax || 0,
          totalAmount: totalAmount || 0,
          invoiceDate: invoiceDate ? new Date(invoiceDate) : new Date(),
          dueDate: dueDate ? new Date(dueDate) : null,
        }
      },
      // [PERBAIKAN]: Include Lead Company & Creator Name untuk Notifikasi
      include: {
        lead: { select: { company: true, title: true } },
        createdBy: { select: { id: true, name: true, avatar: true } }
      }
    });

    // --- NOTIFICATION LOGIC ---
    // Beritahu SEMUA ADMIN bahwa Invoice baru telah dibuat
    const admins = await prisma.user.findMany({ 
        where: { role: 'ADMIN' }, 
        select: { id: true } 
    });

    for (const admin of admins) {
        // Jangan notif diri sendiri jika yang buat adalah Admin itu sendiri
        if (admin.id !== userId) {
            await sendNotification(admin.id, "notifyInvoice", {
                title: "New Invoice Created",
                message: `${newInvoice.createdBy?.name || userName} created invoice #${invoiceNumber} for ${newInvoice.lead?.company || 'Client'}.`,
                link: `/leads/${leadId}`, // Arahkan ke Lead Detail
                type: "INFO"
            });
        }
    }

    return res.status(201).json({
      success: true,
      message: "Invoice created successfully",
      data: newInvoice
    });

  } catch (error) {
    console.error("Create Invoice Error:", error);
    return res.status(500).json({ error: "Failed to create invoice" });
  }
};

/**
 * Mengambil SEMUA invoices untuk satu lead (untuk tab Invoice)
 */
export const getLeadInvoices = async (req: Request, res: Response) => {
  const { leadId } = req.params;
  try {
    const invoices = await prisma.leadActivity.findMany({
      where: {
        leadId,
        type: ActivityType.INVOICE, // Hanya ambil tipe INVOICE
      },
      orderBy: { createdAt: 'desc' },
      include: {
        createdBy: { select: { id: true, name: true, avatar: true } },
      },
    });
    res.status(200).json(invoices);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch invoices' });
  }
};

/**
 * Mengambil SATU invoice berdasarkan ID
 */
export const getLeadInvoiceById = async (req: Request, res: Response) => {
  const { leadId, invoiceId } = req.params;

  try {
    const invoice = await prisma.leadActivity.findFirst({
      where: {
        id: invoiceId,
        leadId: leadId,
        type: ActivityType.INVOICE,
      },
      // 👇 TAMBAHAN PENTING: Sertakan data user pembuat
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true // Pastikan ini ada jika frontend butuh avatar
          }
        }
      }
    });

    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    res.status(200).json(invoice);
  } catch (error) {
    // 👇 TAMBAHAN PENTING: Log error ke terminal agar tahu salahnya dimana
    console.error("Error fetching invoice detail:", error); 
    
    res.status(500).json({ error: 'Failed to fetch invoice' });
  }
};

/**
 * Meng-update INVOICE
 */
export const updateLeadInvoice = async (req: Request, res: Response) => {
  const { leadId, invoiceId } = req.params;
  
  // Ambil data dari body
  const { content, title, meta } = req.body;
  const sourceData = meta || req.body;
  const { 
      items, notes, billedBy, billedTo, 
      subtotal, tax, totalAmount, 
      status, invoiceDate, dueDate 
  } = sourceData;

  // @ts-ignore
  const userId = req.user?.userId;
  // @ts-ignore
  const userRole = req.user?.role; 

  try {
    // 🔥 PERUBAHAN 1: Ambil Invoice SEKALIGUS data tim (assignedUsers) dari Lead
    const invoiceToUpdate = await prisma.leadActivity.findFirst({
      where: { id: invoiceId, leadId: leadId },
      include: {
        lead: {
            include: {
                assignedUsers: { select: { id: true } } // Kita butuh ID user di tim ini
            }
        }
      }
    });

    if (!invoiceToUpdate) return res.status(404).json({ error: 'Invoice not found' });

    // 🔥 PERUBAHAN 2: Logic Izin "Team Ownership"
    const isCreator = invoiceToUpdate.createdById === userId;
    const isAdmin = userRole === 'ADMIN';
    // Cek: Apakah userId yang login ada di dalam daftar assignedUsers?
    const isTeamMember = invoiceToUpdate.lead?.assignedUsers.some(user => user.id === userId);

    // IZINKAN JIKA: Dia Pembuat, ATAU Dia Admin, ATAU Dia Anggota Tim
    if (!isCreator && !isAdmin && !isTeamMember) {
      return res.status(403).json({ error: 'Access denied. You are not assigned to this lead.' });
    }

    // --- Kode Update di bawah ini tetap sama ---
    const finalTitle = title || content || invoiceToUpdate.title;
    const oldStatus = (invoiceToUpdate.meta as any)?.status; 

    const updatedMeta = {
      ...(invoiceToUpdate.meta as any),
      status,
      items, notes, billedBy, billedTo, 
      subtotal, tax, totalAmount,
      invoiceDate: invoiceDate ? new Date(invoiceDate) : null,
      dueDate: dueDate ? new Date(dueDate) : null,
    };

    const updatedInvoice = await prisma.leadActivity.update({
      where: { id: invoiceId },
      data: { 
        title: finalTitle,
        meta: updatedMeta, 
        updatedAt: new Date(),
      },
      // Include lagi saat return biar frontend dapet data lengkap
      include: {
        lead: {
            include: {
                assignedUsers: { select: { id: true } }
            }
        }
      }
    });

    // ... (Logic Notifikasi "PAID" biarkan seperti sebelumnya) ...

    res.status(200).json(updatedInvoice);
  } catch (error) {
    console.error("Update Invoice Error:", error);
    res.status(500).json({ error: 'Failed to update invoice' });
  }
};

/**
 * Menghapus INVOICE
 */
export const deleteLeadInvoice = async (req: Request, res: Response) => {
  const { leadId, invoiceId } = req.params;
  // @ts-ignore
  const userId = req.user?.userId;
  // @ts-ignore
  const userRole = req.user?.role;

  try {
    // 🔥 PERUBAHAN 1: Include Lead & Assigned Users
    const invoiceToDelete = await prisma.leadActivity.findFirst({
      where: { id: invoiceId, leadId: leadId },
      include: {
        lead: {
            include: {
                assignedUsers: { select: { id: true } }
            }
        }
      }
    });

    if (!invoiceToDelete) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    // 🔥 PERUBAHAN 2: Logic Izin (Sama seperti Update)
    const isCreator = invoiceToDelete.createdById === userId;
    const isAdmin = userRole === 'ADMIN';
    const isTeamMember = invoiceToDelete.lead?.assignedUsers.some(user => user.id === userId);

    // Jika bukan siapa-siapa, tolak
    if (!isCreator && !isAdmin && !isTeamMember) {
      return res.status(403).json({ error: 'Access denied to delete this invoice' });
    }

    await prisma.leadActivity.delete({
      where: { id: invoiceId },
    });

    res.status(200).json({ message: 'Invoice deleted successfully' });
  } catch (error) {
    console.error("Delete Invoice Error:", error);
    res.status(500).json({ error: 'Failed to delete invoice' });
  }
};

