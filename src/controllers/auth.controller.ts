import { Request, Response } from 'express';
import prisma from '../config/database';
import { hashPassword, comparePassword } from '../utils/password';
import { generateToken } from '../utils/jwt';
import { sendEmail } from '../utils/email'; // Import helper email

// 1. DEFINISIKAN TIPE DATA DARI GOOGLE
interface GoogleUserResult {
  sub: string;      // ID Unik Google
  name: string;
  given_name: string;
  family_name: string;
  picture: string;
  email: string;
  email_verified: boolean;
  locale: string;
}

// --- LOGIN VIA GOOGLE ---
export const googleLogin = async (req: Request, res: Response): Promise<void> => {
  try {
    const { token } = req.body; 

    const googleRes = await fetch(`https://www.googleapis.com/oauth2/v3/userinfo`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!googleRes.ok) {
      res.status(400).json({ error: 'Invalid Google Token' });
      return;
    }

    // Gunakan 'as GoogleUserResult'
    const payload = (await googleRes.json()) as GoogleUserResult;
    const { email, name, picture, sub: googleId } = payload;

    // Cek user
    let user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
       // Login Strict (User harus register dulu)? Atau Auto-Register?
       // Karena frontend ada tombol Google di Login, biasanya Auto-Register.
       user = await prisma.user.create({
        data: {
          email,
          name: name || 'User Google',
          googleId: googleId,
          avatar: picture,
          role: 'VIEWER',
          status: 'ACTIVE',
          // Password kosong
        },
      });
    } else {
      // Update Google ID jika user lama login pakai Google
      if (!user.googleId) {
        await prisma.user.update({
          where: { id: user.id },
          data: { googleId, avatar: picture || user.avatar },
        });
      }
    }

    const appToken = generateToken({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    res.status(200).json({
      message: 'Google login successful',
      user,
      token: appToken,
    });

  } catch (error) {
    console.error('Google Login Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// --- CEK REGISTER VIA GOOGLE (Pre-fill Form) ---
export const googleRegisterCheck = async (req: Request, res: Response): Promise<void> => {
  try {
    const { token } = req.body;

    const googleRes = await fetch(`https://www.googleapis.com/oauth2/v3/userinfo`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!googleRes.ok) {
      res.status(400).json({ error: 'Invalid Google Token' });
      return;
    }

    const payload = (await googleRes.json()) as GoogleUserResult;
    const { email, name, picture } = payload;

    // Cek apakah user SUDAH ADA?
    const existingUser = await prisma.user.findUnique({ where: { email } });

    if (existingUser) {
      res.status(409).json({ error: 'Account already exists. Please login.' });
      return;
    }

    // Kembalikan data untuk diisi ke form frontend
    res.status(200).json({
      email,
      name,
      avatar: picture
    });

  } catch (error) {
    console.error('Google Register Check Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// --- REGISTER MANUAL ---
export const register = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, email, phone, role, password } = req.body;

    if (!name || !email || !password) {
      res.status(400).json({ error: 'Name, email, and password are required' });
      return;
    }

    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      res.status(409).json({ error: 'User with this email already exists' });
      return;
    }

    const hashedPassword = await hashPassword(password);

    const user = await prisma.user.create({
      data: {
        name,
        email,
        phone,
        role: role?.toUpperCase() || 'VIEWER',
        password: hashedPassword,
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        status: true,
        createdAt: true,
      },
    });

    const token = generateToken({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    res.status(201).json({
      message: 'User registered successfully',
      user,
      token,
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// --- LOGIN MANUAL ---
export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    // Cek jika user tidak punya password (karena login google)
    if (!user.password) {
       res.status(400).json({ error: 'Please login with Google.' });
       return;
    }

    if (user.status === 'INACTIVE') {
      res.status(403).json({ error: 'Account is inactive' });
      return; 
    }

    const isPasswordValid = await comparePassword(password, user.password);

    if (!isPasswordValid) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const token = generateToken({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    res.status(200).json({
      message: 'Login successful',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        status: user.status,
      },
      token,
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// --- GET PROFILE ---
export const getProfile = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        status: true,
        avatar: true,
        createdAt: true,
        updatedAt: true,
        department: true,
        location: true,
        bio: true,
        skills: true,
        joinedAt: true,
        reportsTo: { // Kita juga ambil data manajer
          select: {
            name: true
          }
        },
        assignedLeads: {
          select: {
            id: true,
            title: true,
            status: true,
            company: true
          }
        }
      },
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.status(200).json({ user });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// --- UPDATE PROFILE ---
export const updateProfile = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { name, phone, location, bio, skills } = req.body;

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        name,
        phone,
        location,
        bio,
        skills: skills || [], // Simpan skills sebagai JSON array
      },
      select: { 
        id: true, name: true, email: true, phone: true, role: true,
        status: true, avatar: true, createdAt: true, updatedAt: true,
        department: true, location: true, bio: true, skills: true,
        joinedAt: true, reportsToId: true,
      },
    });

    res.status(200).json({ user: updatedUser, message: 'Profile updated successfully' });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// --- CHANGE PASSWORD ---
export const changePassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      res.status(400).json({ error: 'Current and new passwords are required' });
      return;
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.password) { // Cek jika user tidak punya password (google login)
      res.status(400).json({ error: 'User not found or logged in via Google' });
      return;
    }

    // Verifikasi password saat ini
    const isPasswordValid = await comparePassword(currentPassword, user.password);
    if (!isPasswordValid) {
      res.status(403).json({ error: 'Incorrect current password' });
      return;
    }
    
    if (newPassword.length < 8) {
      res.status(400).json({ error: 'New password must be at least 8 characters long' });
      return;
    }

    const hashedNewPassword = await hashPassword(newPassword);
    await prisma.user.update({
      where: { id: userId },
      data: { password: hashedNewPassword },
    });

    res.status(200).json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// --- FORGOT PASSWORD (Minta OTP) ---
export const forgotPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      res.status(404).json({ error: 'Email not found' });
      return;
    }

    // GENERATE KODE 6 DIGIT (100000 - 999999)
    const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
    
    const passwordResetExpires = new Date(Date.now() + 15 * 60 * 1000); // 15 menit

    await prisma.user.update({
      where: { id: user.id },
      data: {
        resetPasswordToken: resetCode,
        resetPasswordExpires: passwordResetExpires,
      },
    });

    // Kirim Email Asli
    const emailSubject = 'Reset Password OTP - CRM App';
    const emailMessage = `Halo ${user.name},\n\nKode OTP reset password Anda adalah:\n\n${resetCode}\n\nBerlaku selama 15 menit.`;

    const isSent = await sendEmail(email, emailSubject, emailMessage);

    if (!isSent) {
      // Fallback jika email gagal: Log ke console (untuk dev)
      console.log(`Gagal kirim email. OTP untuk ${email}: ${resetCode}`);
      // Tapi tetap return error ke user
      res.status(500).json({ error: 'Failed to send email. Please try again later.' });
      return;
    }

    res.status(200).json({ message: 'OTP code sent to email' });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// --- RESET PASSWORD (Verify OTP) ---
export const resetPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, code, newPassword } = req.body;

    const user = await prisma.user.findFirst({
      where: {
        email: email,
        resetPasswordToken: code,
        resetPasswordExpires: {
          gt: new Date(),
        },
      },
    });

    if (!user) {
      res.status(400).json({ error: 'Invalid or expired OTP code' });
      return;
    }

    const hashedPassword = await hashPassword(newPassword);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        resetPasswordToken: null,
        resetPasswordExpires: null,
      },
    });

    res.status(200).json({ message: 'Password successfully reset' });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};