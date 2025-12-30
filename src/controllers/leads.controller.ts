import { Request, Response } from 'express';
import prisma from '../config/database';
import { ActivityType } from '@prisma/client';
import fs from 'fs/promises';
import path from 'path';
import { sendCRMEmail } from '../utils/email';
import { generateInvoiceNumber } from '../utils/invoiceGenerator';

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
    // --- PERBAIKAN: Pisahkan 'assignedUserIds' dari 'updateData'
    const { assignedUserIds, ...updateData } = req.body;

    // Ambil lead yang ada, sertakan user yang ditugaskan untuk otorisasi
    const existingLead = await prisma.lead.findUnique({ 
      where: { id },
      include: { assignedUsers: { select: { id: true } } } 
    });

    if (!existingLead) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }

    // --- PERBAIKAN: Logika otorisasi untuk SALES (Admin akan lolos)
    if (
      req.user?.role === 'SALES' && 
      !existingLead.assignedUsers.some(user => user.id === req.user?.userId)
    ) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    if (updateData.status === 'WON' && existingLead.status !== 'WON') {
      updateData.wonAt = new Date();
    } else if (updateData.status === 'LOST' && existingLead.status !== 'LOST') {
      updateData.lostAt = new Date();
    }

    const lead = await prisma.lead.update({
      where: { id },
      data: {
        ...updateData,
        dueDate: updateData.dueDate ? new Date(updateData.dueDate) : undefined,
        // --- PERBAIKAN: Gunakan 'set' untuk me-replace daftar user
        assignedUsers: assignedUserIds ? {
          set: (assignedUserIds as string[]).map(id => ({ id: id }))
        } : undefined // 'set' akan mengganti semua user lama dengan daftar baru
      },
      include: {
        // --- PERBAIKAN: Menggunakan 'assignedUsers'
        assignedUsers: { select: { id: true, name: true, email: true, avatar: true } },
      },
    });

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

    // (Logika Admin sudah benar, tidak perlu otorisasi sales)
    if (req.user?.role !== 'ADMIN') {
      res.status(403).json({ error: 'Only admins can delete leads' });
      return;
    }

    const lead = await prisma.lead.findUnique({ where: { id } });
    if (!lead) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }

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
  console.log('BACKEND_URL:', process.env.BACKEND_URL);

  const { leadId } = req.params;
  const { content } = req.body; // Data dari frontend tetap bernama 'content'
  const file = req.file; 
  const userId = (req as any).user?.userId;

  if (!userId) {
     return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!content) {
     return res.status(400).json({ error: 'Content is required' });
  }
  
  let meta: any = {};

  if (file) {
    const filePath = file.path.replace(/\\/g, '/');
    meta.attachmentUrl = `${process.env.BACKEND_URL}/${filePath}`;
    meta.attachmentPath = filePath; 
  }

  try {
    const newNote = await prisma.leadActivity.create({
      data: {
        leadId: leadId,
        createdById: userId,
        type: ActivityType.NOTE, // Pastikan ActivityType diimport

        // --- PERBAIKAN DISINI ---
        description: content, // Mapping: Variabel 'content' masuk ke kolom 'description'
        title: 'Note',        // Kita beri judul default karena kolom 'title' wajib/ada di schema baru
        
        meta: meta,
        
        // Opsional: Set scheduledAt ke waktu sekarang agar muncul di log activity
        scheduledAt: new Date() 
      },
    });
    res.status(201).json(newNote);
  } catch (error) {
    console.error("Create Note Error:", error); // Log error biar gampang debug
    res.status(500).json({ error: 'Failed to create note' });
  }
};

/**
 * Membuat aktivitas baru (Call, Meeting, dll)
 */
export const createLeadActivity = async (req: Request, res: Response) => {
  const { leadId } = req.params;
  
  // Kita terima input lama ('content') dan input baru ('title', 'scheduledAt', dll)
  // tujuannya agar kompatibel dengan frontend lama maupun baru
  const { type, content, title, description, meta, scheduledAt, location, isCompleted } = req.body;
  
  const userId = (req as any).user?.userId;

  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized. User ID not found.' });
  }
  if (!type || !Object.values(ActivityType).includes(type as ActivityType)) {
    return res.status(400).json({ error: 'Invalid activity type' });
  }

  // LOGIC MAPPING:
  // 1. Tentukan Title: Gunakan 'title' jika ada, jika tidak gunakan 'content'
  const finalTitle = title || content;
  
  if (!finalTitle) {
    return res.status(400).json({ error: 'Title (content) is required' });
  }

  // 2. Tentukan Description: Cek input 'description', atau ambil dari 'meta.description'
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
        
        // --- PERBAIKAN DISINI (Sesuai Schema Baru) ---
        title: finalTitle,           // Masuk ke kolom 'title'
        description: finalDescription || '', // Masuk ke kolom 'description'
        
        // Field tambahan untuk Dashboard
        location: location || null,
        scheduledAt: scheduledAt ? new Date(scheduledAt) : new Date(), // Kalau kosong, anggap sekarang
        isCompleted: isCompleted || false,

        meta: meta, // Meta tetap disimpan sebagai JSON (opsional)
      },
    });
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
  const { content, removeAttachment } = req.body; // 'content' dari frontend
  const file = req.file;
  const userId = (req as any).user?.userId;

  if (!content) { 
    return res.status(400).json({ error: 'Content is required' });
  }

  try {
    const noteToUpdate = await prisma.leadActivity.findFirst({
      where: { id: noteId, leadId: leadId },
    });
    
    if (!noteToUpdate) { 
      return res.status(404).json({ error: 'Note not found' }); 
    }
    
    // Cek Permission: Hanya pembuat atau ADMIN yang boleh edit
    if (noteToUpdate.createdById !== userId && (req as any).user?.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Ambil meta yang ada
    let meta = (noteToUpdate.meta as any) || {};
    const oldPath = meta.attachmentPath;

    // --- LOGIKA FILE BARU ---
    if (file) {
      // 1. Hapus file lama jika ada
      if (oldPath) {
        try { await fs.unlink(path.resolve(oldPath)); } catch (e) { console.warn("Failed to delete old file:", oldPath); }
      }
      // 2. Set file baru
      const filePath = file.path.replace(/\\/g, '/');
      meta.attachmentUrl = `${process.env.BACKEND_URL}/${filePath}`;
      meta.attachmentPath = filePath;
    } 
    else if (removeAttachment === 'true') {
      // 3. Hapus file jika user menekan 'x'
      if (oldPath) {
        try { await fs.unlink(path.resolve(oldPath)); } catch (e) { console.warn("Failed to delete old file:", oldPath); }
      }
      meta.attachmentUrl = null;
      meta.attachmentPath = null;
    }

    const updatedNote = await prisma.leadActivity.update({
      where: { id: noteId },
      data: { 
        // --- PERBAIKAN DISINI ---
        description: content, // Mapping: 'content' masuk ke 'description'
        // Kolom 'content' dihapus dari sini karena sudah tidak ada di DB
        
        meta: meta, 
      },
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

    // --- LOGIKA HAPUS FILE ---
    const meta = (noteToDelete.meta as any) || {};
    const localPath = meta.attachmentPath; // Ambil path lokal (e.g., 'uploads/123-file.png')
    
    if (localPath) {
      try {
        // 'path.resolve(localPath)' membuat path absolut dari path relatif
        // Ini memastikan 'fs' tahu di mana file itu berada
        await fs.unlink(path.resolve(localPath));
      } catch (err) {
        // Jangan hentikan proses jika file gagal dihapus, 
        // mungkin file-nya sudah tidak ada. Cukup catat.
        console.warn(`Failed to delete file from disk: ${localPath}`, err);
      }
    }

    await prisma.leadActivity.delete({
      where: { id: noteId },
    });

    res.status(200).json({ message: 'Note deleted successfully' });
  } catch (error) {
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
        type: ActivityType.MEETING, // Hanya ambil tipe MEETING
      },
      orderBy: { createdAt: 'desc' },
      include: {
        createdBy: { select: { id: true, name: true, avatar: true } },
      },
    });
    res.status(200).json(meetings);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch meetings' });
  }
};

/**
 * Mengambil SATU meeting berdasarkan ID
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
    });

    if (!meeting) {
      return res.status(404).json({ error: 'Meeting not found' });
    }
    // Otorisasi bisa ditambahkan di sini jika perlu
    res.status(200).json(meeting);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch meeting' });
  }
};

/**
 * Meng-update MEETING
 * Berbeda dari Note, 'content' adalah 'title', dan sisanya ada di 'meta'
 */
export const updateLeadMeeting = async (req: Request, res: Response) => {
  const { leadId, meetingId } = req.params;
  
  // Kita destructure lebih banyak field untuk mendukung schema baru
  // content = title (dari frontend lama)
  const { content, title, meta, location, scheduledAt, description } = req.body; 
  
  const userId = (req as any).user?.userId;

  // Logic: Title bisa dari 'title' atau 'content'
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

    // Cek apakah ada description di dalam meta (untuk backward compatibility)
    let finalDescription = description;
    if (!finalDescription && meta && meta.description) {
        finalDescription = meta.description;
    }

    const updatedMeeting = await prisma.leadActivity.update({
      where: { id: meetingId },
      data: { 
        // --- PERBAIKAN DISINI ---
        title: finalTitle,       // Mapping: 'content' masuk ke 'title'
        description: finalDescription || '', // Mapping description
        
        // Field tambahan (Update jika dikirim frontend)
        location: location,
        scheduledAt: scheduledAt ? new Date(scheduledAt) : undefined,
        
        meta: meta, // Meta tetap disimpan full
      },
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
    
    // Konversi isDraft ke boolean
    const isDraftBool = isDraft === 'true' || isDraft === true;

    const file = req.file;
    // @ts-ignore
    const tokenUser = req.user; 

    if (!tokenUser) return res.status(401).json({ message: "Unauthorized" });

    const userDetail = await prisma.user.findUnique({ where: { id: tokenUser.userId } });
    const senderName = userDetail?.name || "Team"; 
    const fromLabel = `${senderName} from CMLABS`;
    const finalReplyTo = replyTo ? replyTo : process.env.SMTP_EMAIL;

    // --- LOGIKA ATTACHMENT ---
    let emailAttachments: any[] = [];
    let savedAttachmentUrl = null;
    let savedAttachmentPath = null;

    if (file) {
      // 1. FIX UNTUK NODEMAILER (Agar file terkirim)
      // Gunakan path.resolve untuk mendapatkan Absolute Path (D:\Folder\uploads\file.pdf)
      const absolutePath = path.resolve(file.path);
      
      emailAttachments.push({
        filename: file.originalname,
        path: absolutePath // Nodemailer butuh path absolut di Windows
      });

      // 2. FIX UNTUK URL DATABASE (Agar PDF tidak blank)
      // Kita pakai file.filename (nama acak dari multer) yang bersih tanpa slash
      const baseUrl = process.env.BACKEND_URL || process.env.BASE_URL || 'http://localhost:5000';
      savedAttachmentUrl = `${baseUrl}/uploads/${file.filename}`;
      
      // Simpan path relatif untuk keperluan hapus file nanti
      savedAttachmentPath = file.path; 
    }

    // --- KIRIM EMAIL (Hanya jika bukan Draft) ---
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
        
        // --- PERBAIKAN DISINI ---
        title: subject,  // Ganti 'content' jadi 'title'
        description: message || '', // Opsional: Simpan body email di description
        
        meta: {
          status: isDraftBool ? 'DRAFT' : 'SENT',
          from: fromLabel,
          to, cc, bcc, replyTo: finalReplyTo,
          messageBody: message,
          attachmentUrl: savedAttachmentUrl, 
          attachmentPath: savedAttachmentPath 
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
    console.error("Controller Error:", error);
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

    // --- LOGIKA FILE BARU ---
    if (file) {
      // Hapus file lama
      if (currentMeta.attachmentPath) {
        try { await fs.unlink(path.resolve(currentMeta.attachmentPath)); } catch (e) {}
      }
      
      const baseUrl = process.env.BACKEND_URL || process.env.BASE_URL || 'http://localhost:5000';
      currentMeta.attachmentUrl = `${baseUrl}/uploads/${file.filename}`;
      currentMeta.attachmentPath = file.path;
    }

    // --- LOGIKA KIRIM DRAFT SEKARANG ---
    const isSendingNow = currentMeta.status === 'DRAFT' && (isDraft === 'false' || isDraft === false);

    if (isSendingNow) {
      console.log("🚀 Sending DRAFT email now...");
      const userDetail = await prisma.user.findUnique({ where: { id: userId } });
      const senderName = userDetail?.name || "Team"; 

      let attachments = [];
      
      // Ambil path dari file yang baru diupload ATAU dari database
      // Prioritaskan file yang baru diupload jika ada
      const pathToSend = file ? file.path : currentMeta.attachmentPath;

      if (pathToSend) {
        // FIX: Resolusi Path Absolut untuk Nodemailer
        const absolutePath = path.resolve(pathToSend);
        
        // Cek apakah file ada sebelum kirim
        try {
            await fs.access(absolutePath);
            attachments.push({ 
                filename: path.basename(absolutePath), 
                path: absolutePath // Path Absolut
            });
        } catch (e) {
            console.warn("Attachment file not found on disk:", absolutePath);
        }
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
         title: newSubject, // Ganti 'content' jadi 'title'
         meta: currentMeta 
      },
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
    // 1. Cari dulu datanya (jangan langsung delete)
    const emailToDelete = await prisma.leadActivity.findFirst({
      where: { id: emailId, leadId: leadId },
    });

    if (!emailToDelete) {
      return res.status(404).json({ error: 'Email log not found' });
    }

    // 2. Cek Permission (Hanya Pembuat atau Admin yang boleh hapus)
    // @ts-ignore
    if (emailToDelete.createdById !== userId && userRole !== 'ADMIN') {
      return res.status(403).json({ error: 'Access denied' });
    }

    // 3. --- LOGIKA HAPUS FILE FISIK ---
    // Ambil data meta untuk melihat apakah ada attachment
    const meta = (emailToDelete.meta as any) || {};
    const localPath = meta.attachmentPath; // Kita ambil path yang tersimpan (misal: uploads/123.pdf)

    if (localPath) {
      try {
        // Resolve path agar menjadi absolut (C:\Project\uploads\123.pdf)
        const absolutePath = path.resolve(localPath);
        
        // Cek apakah file ada, lalu hapus
        await fs.access(absolutePath); // Cek eksistensi
        await fs.unlink(absolutePath); // Hapus file
        console.log(`🗑️ File deleted: ${absolutePath}`);
      } catch (err) {
        // Jika file tidak ketemu (mungkin sudah dihapus manual), biarkan saja jangan error
        console.warn(`⚠️ Warning: Failed to delete attachment file: ${localPath}`, err);
      }
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
    
    // [FIX UTAMA]: Ambil data dari 'req.body.meta' karena Frontend mengirimnya di dalam object meta
    // Jika tidak ada di meta, coba cari di root body (fallback)
    const sourceData = req.body.meta || req.body;

    const { 
      dueDate, items, notes, 
      billedBy, billedTo, 
      subtotal, tax, totalAmount, 
      status, invoiceDate 
    } = sourceData;
    
    // @ts-ignore
    const userId = req.user?.userId;

    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    // Generate Auto Number
    const invoiceNumber = await generateInvoiceNumber();

    const newInvoice = await prisma.leadActivity.create({
      data: {
        leadId: leadId,
        createdById: userId,
        type: ActivityType.INVOICE,
        
        // --- PERBAIKAN DISINI ---
        title: invoiceNumber,   // Ganti 'content' jadi 'title'
        description: 'Invoice', // Isi description default biar tidak null
        
        meta: {
          status: status || 'draft', 
          items: items || [],
          notes: notes || '',
          billedBy: billedBy || '',
          billedTo: billedTo || '',
          
          // Angka
          subtotal: subtotal || 0,
          tax: tax || 0,
          totalAmount: totalAmount || 0, // Pastikan ini terpakai
          
          // Tanggal (Penting dikonversi ke Date object)
          invoiceDate: invoiceDate ? new Date(invoiceDate) : new Date(),
          dueDate: dueDate ? new Date(dueDate) : null,
        }
      },
      include: {
        createdBy: { select: { id: true, name: true, avatar: true } }
      }
    });

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
    });

    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    res.status(200).json(invoice);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch invoice' });
  }
};

/**
 * Meng-update INVOICE
 */
export const updateLeadInvoice = async (req: Request, res: Response) => {
  const { leadId, invoiceId } = req.params;
  
  // Ambil data dari body. Support 'content' (frontend lama) dan 'title' (frontend baru)
  const { content, title, meta } = req.body;
  
  // [FIX UTAMA]: Baca detail invoice dari meta atau root body
  const sourceData = meta || req.body;

  const { 
      items, notes, billedBy, billedTo, 
      subtotal, tax, totalAmount, 
      status, invoiceDate, dueDate 
  } = sourceData;

  // @ts-ignore
  const userId = req.user?.userId;

  try {
    const invoiceToUpdate = await prisma.leadActivity.findFirst({
      where: { id: invoiceId, leadId: leadId },
    });

    if (!invoiceToUpdate) return res.status(404).json({ error: 'Invoice not found' });

    // @ts-ignore
    if (invoiceToUpdate.createdById !== userId && req.user?.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Logic Mapping: 
    // 1. Coba ambil 'title' baru
    // 2. Kalau tidak ada, ambil 'content' (input lama)
    // 3. Kalau tidak ada juga, pakai title yang sudah ada di database (biar gak hilang)
    const finalTitle = title || content || invoiceToUpdate.title;

    // Update Meta
    const updatedMeta = {
      ...(invoiceToUpdate.meta as any), // Pertahankan data lama
      status,
      items,
      notes,
      billedBy,
      billedTo,
      subtotal,
      tax,
      totalAmount,
      invoiceDate: invoiceDate ? new Date(invoiceDate) : null,
      dueDate: dueDate ? new Date(dueDate) : null,
    };

    const updatedInvoice = await prisma.leadActivity.update({
      where: { id: invoiceId },
      data: { 
        // --- PERBAIKAN DISINI ---
        title: finalTitle, // Kolom 'content' diganti jadi 'title'
        
        // Opsional: Jika Anda ingin 'dueDate' invoice muncul di Kalender Dashboard sebagai 'Upcoming Activity',
        // Anda bisa menyalakan baris di bawah ini:
        // scheduledAt: dueDate ? new Date(dueDate) : undefined,

        meta: updatedMeta, 
      },
    });

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
  const userId = (req as any).user?.userId;

  try {
    const invoiceToDelete = await prisma.leadActivity.findFirst({
      where: { id: invoiceId, leadId: leadId },
    });

    if (!invoiceToDelete) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    if (invoiceToDelete.createdById !== userId && (req as any).user?.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Access denied to delete this invoice' });
    }

    await prisma.leadActivity.delete({
      where: { id: invoiceId },
    });

    res.status(200).json({ message: 'Invoice deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete invoice' });
  }
};

