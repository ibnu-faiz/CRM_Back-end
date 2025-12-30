import prisma from '../config/database'; 
import { ActivityType } from '@prisma/client';

export const generateInvoiceNumber = async (): Promise<string> => {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0'); // '01', '02', ... '12'
  
  // Format Prefix yang diinginkan: INV/2025/12/
  const prefix = `INV/${year}/${month}/`;

  // 1. Cari invoice terakhir yang dibuat bulan ini
  const lastInvoice = await prisma.leadActivity.findFirst({
    where: {
      type: ActivityType.INVOICE, // Hanya cari tipe INVOICE
      
      // [PERBAIKAN]: Gunakan 'title' karena kolom 'content' sudah dihapus
      title: {
        startsWith: prefix // Cari yang depannya 'INV/2025/12/'
      }
    },
    orderBy: {
      createdAt: 'desc' // Ambil yang paling baru
    }
  });

  // 2. Tentukan nomor urut
  let sequence = 1;

  // [PERBAIKAN]: Cek 'title', bukan 'content'
  if (lastInvoice && lastInvoice.title) {
    // Contoh title: "INV/2025/12/0005"
    // Kita ambil bagian belakangnya ("0005")
    const parts = lastInvoice.title.split('/');
    const lastSeqString = parts[parts.length - 1]; // "0005"
    const lastSeqNumber = parseInt(lastSeqString, 10);

    if (!isNaN(lastSeqNumber)) {
      sequence = lastSeqNumber + 1;
    }
  }

  // 3. Format nomor urut jadi 4 digit (0001, 0002, dst)
  const sequenceString = String(sequence).padStart(4, '0');

  // 4. Gabungkan
  return `${prefix}${sequenceString}`;
};