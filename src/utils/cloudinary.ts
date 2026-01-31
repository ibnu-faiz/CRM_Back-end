// src/utils/cloudinary.ts
import { v2 as cloudinary } from 'cloudinary';
import dotenv from 'dotenv';

dotenv.config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export const deleteFileFromCloudinary = async (fileUrl: string) => {
  if (!fileUrl) return;

  try {
    // 1. Ambil public_id dari URL
    const parts = fileUrl.split('/upload/');
    if (parts.length < 2) return;

    let publicIdWithExtension = parts[1];
    
    // Hapus versioning (v12345/) jika ada
    if (publicIdWithExtension.startsWith('v')) {
        const versionIndex = publicIdWithExtension.indexOf('/');
        if (versionIndex !== -1) {
            publicIdWithExtension = publicIdWithExtension.substring(versionIndex + 1);
        }
    }

    // Hapus ekstensi (.jpg, .pdf)
    const lastDotIndex = publicIdWithExtension.lastIndexOf('.');
    const publicId = lastDotIndex !== -1 
        ? publicIdWithExtension.substring(0, lastDotIndex) 
        : publicIdWithExtension;

    const finalPublicId = decodeURIComponent(publicId);

    console.log(`🗑️ Deleting Cloudinary File: ${finalPublicId}`);

    // 2. Coba hapus sebagai 'image' (PDF mode auto masuk sini)
    await cloudinary.uploader.destroy(finalPublicId, { resource_type: 'image' }, async (error, result) => {
        if (result && result.result === 'not found') {
            // 3. Jika gagal, coba hapus sebagai 'raw' (dokumen lama)
            await cloudinary.uploader.destroy(finalPublicId, { resource_type: 'raw' });
        }
    });

  } catch (error) {
    console.error("❌ Gagal hapus file Cloudinary:", error);
  }
};