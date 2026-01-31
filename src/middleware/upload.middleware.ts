// src/middleware/upload.middleware.ts
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ==========================================
// CONFIG A: FILE UMUM (PDF, DOC, JPG)
// ==========================================

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    // 1. Ambil Ekstensi (contoh: "pdf") & Nama File
    // Kita buang titiknya biar bersih ("pdf")
    const ext = path.extname(file.originalname).substring(1).toLowerCase(); 
    const originalName = path.basename(file.originalname, `.${ext}`);

    // 2. Sanitasi Nama (Ganti Spasi jadi Underscore)
    const safeName = originalName.replace(/[^a-zA-Z0-9]/g, "_");

    return {
      folder: 'crm-uploads',
      
      // 🔥 KUNCI 1: Pakai 'auto' supaya PDF dianggap Image (Bisa Thumbnail)
      resource_type: 'auto', 
      
      // 🔥 KUNCI 2: Paksa FORMAT sesuai aslinya
      // Ini menjamin file tersimpan sebagai ".pdf", bukan file tanpa ekstensi
      format: ext, 

      // Nama unik & bersih
      public_id: `${Date.now()}-${safeName}`,
    };
  },
});

const fileFilter = (req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowedTypes = /jpeg|jpg|png|pdf|doc|docx/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);

  if (extname) {
    return cb(null, true);
  }
  cb(new Error('Error: File type not supported!'));
};

export const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, 
  fileFilter: fileFilter
});

// ==========================================
// CONFIG B: AVATAR (SAMA SEPERTI SEBELUMNYA)
// ==========================================
const avatarStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    const originalName = file.originalname.split('.')[0];
    const safeName = originalName.replace(/[^a-zA-Z0-9]/g, "_");
    return {
      folder: 'crm-avatars',
      allowed_formats: ['jpg', 'png', 'jpeg', 'webp'],
      transformation: [{ width: 500, height: 500, crop: 'limit' }],
      resource_type: 'image',
      public_id: `avatar-${Date.now()}-${safeName}`,
    };
  },
});

const imageFilter = (req: any, file: any, cb: any) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Only images allowed!'), false);
  }
};

export const uploadAvatarMiddleware = multer({ 
  storage: avatarStorage,
  fileFilter: imageFilter,
  limits: { fileSize: 2 * 1024 * 1024 }
});