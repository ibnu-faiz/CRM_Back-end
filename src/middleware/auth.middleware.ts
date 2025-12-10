// src/middleware/auth.middleware.ts
import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/jwt'; // Pastikan util ini mengembalikan payload yang benar

// Deklarasikan tipe 'user' pada Request Express
declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string; // Kita akan pastikan untuk menggunakan 'userId'
        email: string;
        role: string;
      };
    }
  }
}

export const authenticateToken = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      res.status(401).json({ error: 'Access token required' });
      return;
    }

    // Pastikan verifyToken mengembalikan objek: { userId: '...', email: '...', role: '...' }
    const decoded = verifyToken(token); 
    
    // Ini adalah baris kuncinya
    req.user = decoded as { userId: string; email: string; role: string };
    
    next();
  } catch (error) {
    res.status(403).json({ error: 'Invalid or expired token' });
  }
};