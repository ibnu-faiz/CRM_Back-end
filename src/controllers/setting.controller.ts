import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// GET: Ambil data setting buat ditampilkan di Frontend
export const getInvoiceSettings = async (req: Request, res: Response) => {
  try {
    // Cari settingan dengan ID 'default_config'
    let settings = await prisma.invoiceSetting.findUnique({
      where: { id: "default_config" }
    });

    // Kalau belum ada (pertama kali install), balikin data kosong biar gak error
    if (!settings) {
      return res.status(200).json({
        companyName: "CMLABS",
        companyAddress: "",
        companyEmail: "",
        defaultTax: 10
      });
    }

    res.status(200).json(settings);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch settings" });
  }
};

// PUT: Simpan perubahan dari halaman Settings
export const updateInvoiceSettings = async (req: Request, res: Response) => {

  const userRole = req.user?.role; // Pastikan middleware auth sudah jalan

  // 🔥 1. CEK ROLE: Jika bukan Admin, tolak!
  if (userRole !== "ADMIN") {
    return res.status(403).json({ error: "Access denied. Only Admins can change settings." });
  }
  
  const { companyName, companyAddress, companyEmail, defaultTax } = req.body;

  try {
    // Gunakan UPSERT: Update kalau ada, Create kalau belum ada
    const settings = await prisma.invoiceSetting.upsert({
      where: { id: "default_config" },
      update: {
        companyName,
        companyAddress,
        companyEmail,
        defaultTax: parseFloat(defaultTax) || 0,
      },
      create: {
        id: "default_config",
        companyName,
        companyAddress,
        companyEmail,
        defaultTax: parseFloat(defaultTax) || 0,
      }
    });

    res.status(200).json(settings);
  } catch (error) {
    res.status(500).json({ error: "Failed to save settings" });
  }
};