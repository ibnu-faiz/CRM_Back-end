// src/controllers/team.controller.ts
import { Request, Response } from 'express';
import prisma from '../config/database';
import { hashPassword } from '../utils/password'; // Asumsi Anda punya ini dari auth

// GET /api/team - Mendapatkan semua user (anggota tim)
export const getAllTeamMembers = async (req: Request, res: Response) => {
  try {
    const members = await prisma.user.findMany({
      orderBy: { name: 'asc' },
      // Kita bisa tambahkan filter status atau search di sini nanti
    });
    res.status(200).json(members);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch team members' });
  }
};

// GET /api/team/:id - Mendapatkan satu anggota tim
export const getTeamMemberById = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const member = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        status: true,
        avatar: true,
        createdAt: true,
        department: true,
        location: true,
        bio: true,
        skills: true,
        joinedAt: true,
        reportsToId: true,
        
        // Ambil Info Manager
        reportsTo: { 
            select: { id: true, name: true } 
        },

        // --- TAMBAHAN BARU: Ambil Assigned Leads ---
        assignedLeads: {
            select: {
                id: true,
                title: true,
                status: true,
                company: true
            }
        }
        // ------------------------------------------
      },
    });

    if (!member) {
      return res.status(404).json({ error: 'Team member not found' });
    }
    res.status(200).json(member);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch team member' });
  }
};

// POST /api/team - Membuat anggota tim baru (dari AddTeamModal)
export const createTeamMember = async (req: Request, res: Response) => {
  const { 
    name, 
    email, 
    phone, 
    password, // PENTING: Modal Anda harus mengirim password!
    role, 
    department, 
    status, 
    joinedAt, 
    location, 
    bio, 
    skills, 
    reportsToId 
  } = req.body;

  if (!name || !email || !password || !role) {
    return res.status(400).json({ error: 'Name, email, password, and role are required' });
  }

  try {
    const hashedPassword = await hashPassword(password);
    
    const newMember = await prisma.user.create({
      data: {
        name,
        email,
        phone,
        password: hashedPassword,
        role,
        department,
        status,
        joinedAt: joinedAt ? new Date(joinedAt) : new Date(),
        location,
        bio,
        skills: skills || [], // Simpan skills sebagai JSON
        reportsToId: reportsToId || null,
      },
    });
    // Jangan kirim balik password hash
    const { password: _, ...result } = newMember;
    res.status(201).json(result);
  } catch (error: any) {
    if (error.code === 'P2002') { // Error unik (email sudah ada)
      return res.status(409).json({ error: 'Email already exists' });
    }
    res.status(500).json({ error: 'Failed to create team member' });
  }
};

// PATCH /api/team/:id - Mengupdate anggota tim
export const updateTeamMember = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { 
    name, 
    email, 
    phone, 
    role, 
    department, 
    status, 
    joinedAt, 
    location, 
    bio, 
    skills, 
    reportsToId 
  } = req.body;

  try {
    const updatedMember = await prisma.user.update({
      where: { id },
      data: {
        name,
        email,
        phone,
        role,
        department,
        status,
        joinedAt: joinedAt ? new Date(joinedAt) : undefined,
        location,
        bio,
        skills: skills || undefined,
        reportsToId: reportsToId || null,
      },
    });
    const { password, ...result } = updatedMember;
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update team member' });
  }
};

// DELETE /api/team/:id - Menghapus anggota tim
export const deleteTeamMember = async (req: Request, res: Response) => {
  const { id } = req.params;
  
  // Validasi agar user tidak bisa menghapus diri sendiri (opsional)
  const loggedInUserId = (req as any).user?.userId;
  if (id === loggedInUserId) {
     return res.status(403).json({ error: "You cannot delete your own account." });
  }

  try {
    // TODO: Handle relasi (apa yang terjadi pada leads/activities milik user ini?)
    // Untuk saat ini, kita anggap bisa dihapus
    await prisma.user.delete({
      where: { id },
    });
    res.status(200).json({ message: 'Team member deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete team member' });
  }
};