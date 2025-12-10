import nodemailer from 'nodemailer';

// Konfigurasi Transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.SMTP_EMAIL,
    pass: process.env.SMTP_PASSWORD,
  },
});

// Interface Email Options (Gaya Baru)
interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  cc?: string;
  bcc?: string;
  replyTo?: string;
  senderName?: string;
  attachments?: { filename: string; path: string }[]; 
}

// 1. FUNGSI UTAMA (Gaya Baru - Object Based)
// Ini yang dipakai oleh Leads Controller (Support Attachment)
export const sendCRMEmail = async ({ 
  to, 
  subject, 
  html, 
  cc, 
  bcc, 
  replyTo, 
  senderName,
  attachments 
}: EmailOptions) => {
  try {
    const fromLabel = senderName ? `${senderName} from CMLABS` : `CMLABS CRM`;

    const info = await transporter.sendMail({
      from: `"${fromLabel}" <${process.env.SMTP_EMAIL}>`,
      to,
      cc,
      bcc,
      replyTo,
      subject,
      html,
      attachments, 
    });
    
    console.log("📨 Email Sent via Nodemailer. ID:", info.messageId);
    return info;
  } catch (error) {
    console.error("❌ Nodemailer Error:", error);
    throw new Error("Gagal mengirim email");
  }
};

// ============================================================
// 2. FUNGSI ADAPTOR (PENYELAMAT AUTH CONTROLLER)
// ============================================================
// Fungsi ini menerima 3 argumen terpisah (seperti yang diminta auth.controller.ts)
// lalu menyusunnya menjadi object untuk diproses oleh sendCRMEmail.
export const sendEmail = async (to: string, subject: string, html: string) => {
  return sendCRMEmail({
    to: to,
    subject: subject,
    html: html,
    senderName: "Auth System", // Default nama pengirim untuk OTP/Auth
    attachments: [] // Default kosong
  });
};