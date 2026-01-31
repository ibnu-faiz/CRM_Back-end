// src/controllers/team.controller.ts
import { Request, Response } from 'express';
import prisma from '../config/database';
import { hashPassword } from '../utils/password'; 
// 👇 Import helper sakti penghapus file
import { deleteFileFromCloudinary } from '../utils/cloudinary'; 

// GET /api/team - Mendapatkan semua user
export const getAllTeamMembers = async (req: Request, res: Response) => {
  try {
    const members = await prisma.user.findMany({
      orderBy: { name: 'asc' },
      select: { // Sebaiknya select field agar password tidak ikut terkirim
        id: true, name: true, email: true, role: true, 
        avatar: true, status: true, department: true
      }
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
        id: true, name: true, email: true, phone: true, role: true,
        status: true, avatar: true, createdAt: true, department: true,
        location: true, bio: true, skills: true, joinedAt: true, reportsToId: true,
        
        reportsTo: { 
            select: { id: true, name: true } 
        },

        assignedLeads: {
            select: {
                id: true, title: true, status: true, company: true, 
                createdAt: true, value: true,
                assignedUsers: {
                    select: { name: true, avatar: true }
                }
            }
        },
        leadsCreated: {
            select: {
                id: true, title: true, status: true, company: true, 
                createdAt: true, value: true,
                assignedUsers: { select: { name: true, avatar: true } }
            },
            orderBy: { createdAt: 'desc' } 
        }
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

// POST /api/team - Membuat anggota tim baru
export const createTeamMember = async (req: Request, res: Response) => {
  const { 
    name, email, phone, password, role, department, 
    status, joinedAt, location, bio, skills, reportsToId 
  } = req.body;
  
  // Handle jika admin langsung upload avatar saat create
  const file = req.file; 

  if (!name || !email || !password || !role) {
    return res.status(400).json({ error: 'Name, email, password, and role are required' });
  }

  try {
    const hashedPassword = await hashPassword(password);
    
    // Siapkan data avatar jika ada
    let avatarUrl = null;
    if (file) {
        avatarUrl = file.path;
    }

    const newMember = await prisma.user.create({
      data: {
        name,
        email,
        phone,
        password: hashedPassword,
        role,
        department,
        status,
        avatar: avatarUrl, // Simpan URL Avatar
        joinedAt: joinedAt ? new Date(joinedAt) : new Date(),
        location,
        bio,
        skills: skills || [], 
        reportsToId: reportsToId || null,
      },
    });

    const { password: _, ...result } = newMember;
    res.status(201).json(result);
  } catch (error: any) {
    // Jika error dan sudah terlanjur upload file, hapus lagi filenya (Safety Net)
    if (file) await deleteFileFromCloudinary(file.path);

    if (error.code === 'P2002') { 
      return res.status(409).json({ error: 'Email already exists' });
    }
    res.status(500).json({ error: 'Failed to create team member' });
  }
};

// PATCH /api/team/:id - Mengupdate anggota tim
export const updateTeamMember = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { 
    name, email, phone, role, department, status, 
    joinedAt, location, bio, skills, reportsToId,
    password // Admin mungkin mengganti password user
  } = req.body;
  
  const file = req.file; // Admin mungkin mengganti avatar user

  try {
    // 1. Cari User Lama dulu
    const oldUser = await prisma.user.findUnique({ where: { id } });
    if (!oldUser) return res.status(404).json({ error: 'User not found' });

    let updateData: any = {
        name, email, phone, role, department, status,
        location, bio, skills: skills || undefined,
        reportsToId: reportsToId || null,
        joinedAt: joinedAt ? new Date(joinedAt) : undefined,
    };

    // 2. Logic Update Password (Jika diisi)
    if (password && password.trim() !== "") {
        updateData.password = await hashPassword(password);
    }

    // 3. Logic Update Avatar & Hapus Sampah Cloudinary
    if (file) {
        // Hapus foto lama di Cloudinary jika ada
        if (oldUser.avatar) {
            await deleteFileFromCloudinary(oldUser.avatar);
        }
        // Set foto baru
        updateData.avatar = file.path;
    }

    const updatedMember = await prisma.user.update({
      where: { id },
      data: updateData,
    });

    const { password: newPass, ...result } = updatedMember;
    res.status(200).json(result);
  } catch (error) {
    console.error("Update Team Member Error:", error);
    res.status(500).json({ error: 'Failed to update team member' });
  }
};

// DELETE /api/team/:id - Menghapus anggota tim
export const deleteTeamMember = async (req: Request, res: Response) => {
  const { id } = req.params;
  
  const loggedInUserId = (req as any).user?.userId;
  if (id === loggedInUserId) {
     return res.status(403).json({ error: "You cannot delete your own account." });
  }

  try {
    // 1. Cari User untuk dapat URL Avatar
    const userToDelete = await prisma.user.findUnique({ 
        where: { id },
        select: { avatar: true } // Cuma butuh info avatar
    });

    if (!userToDelete) return res.status(404).json({ error: "User not found" });

    // 2. 🔥 HAPUS FOTO DI CLOUDINARY 🔥
    if (userToDelete.avatar) {
        await deleteFileFromCloudinary(userToDelete.avatar);
    }

    // 3. Hapus User dari DB
    await prisma.user.delete({
      where: { id },
    });
    
    res.status(200).json({ message: 'Team member deleted successfully' });
  } catch (error) {
    console.error("Delete Team Member Error:", error);
    res.status(500).json({ error: 'Failed to delete team member' });
  }
};