import { Request, Response } from 'express';
import { PrismaClient, LeadStatus } from '@prisma/client';

const prisma = new PrismaClient();

interface AuthRequest extends Request {
  user?: {
    userId: string;
    role: string;
    email: string;  
  };
}

export const getSalesReport = async (req: AuthRequest, res: Response) => {
  try {
    // Pastikan konversi ke Number agar aman
    const { viewType } = req.body;
    const year = Number(req.body.year);
    const month = Number(req.body.month);     // Ex: 2 (Februari)
    const quarter = Number(req.body.quarter); // Ex: 1

    // 1. AMBIL DATA USER DARI TOKEN
    const user = req.user; 
    
    if (!user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    // 2. Base Condition
    let whereCondition: any = {
      isArchived: false,
    };

    // Filter Pemilik (Kecuali Admin)
    if (user.role !== 'ADMIN') {
      whereCondition.assignedUsers = {
        some: { id: user.userId }
      };
    }

    let orderByCondition: any = {};
    let startDate: Date;
    let endDate: Date;

    // ==========================================
    // LOGIKA TANGGAL (FIX TIMEZONE WIB)
    // ==========================================
    // Kita gunakan Date.UTC untuk membuat tanggal bersih, 
    // lalu kita kurangi 7 jam agar sesuai jam 00:00 WIB.
    
    if (viewType === 'MONTHLY') {
      // Step 1: Buat tanggal UTC murni sesuai input
      // Note: month - 1 karena di JS bulan dimulai dari 0 (Jan=0, Feb=1)
      startDate = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
      endDate = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999)); // Tanggal 0 bulan berikutnya = tgl terakhir bulan ini

      // Step 2: KOREKSI TIMEZONE WIB (UTC-7)
      // 00:00 WIB adalah 17:00 UTC hari sebelumnya.
      startDate.setHours(startDate.getHours() - 7);
      endDate.setHours(endDate.getHours() - 7);

      whereCondition = {
        ...whereCondition,
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      };

      orderByCondition = { createdAt: 'asc' };
    } 
    
    else if (viewType === 'QUARTERLY') {
      const startMonthIndex = (quarter - 1) * 3;

      // Step 1: Buat tanggal UTC murni
      startDate = new Date(Date.UTC(year, startMonthIndex, 1, 0, 0, 0));
      endDate = new Date(Date.UTC(year, startMonthIndex + 3, 0, 23, 59, 59, 999));

      // Step 2: KOREKSI TIMEZONE WIB (UTC-7)
      startDate.setHours(startDate.getHours() - 7);
      endDate.setHours(endDate.getHours() - 7);

      whereCondition = {
        ...whereCondition,
        status: LeadStatus.WON,
        wonAt: {
          gte: startDate,
          lte: endDate,
        },
      };

      orderByCondition = { value: 'desc' };
    }

    // 3. Eksekusi Query
    const leads = await prisma.lead.findMany({
      where: whereCondition,
      orderBy: orderByCondition,
      include: {
        createdBy: { select: { name: true } },
        assignedUsers: { select: { name: true } } 
      }
    });

    // 4. Hitung Summary
    const summary = {
      totalLeads: leads.length,
      totalValuePipeline: 0,
      totalRevenue: 0,
      countWon: 0,
      countLost: 0,
      countOpen: 0,
    };

    const formattedData = leads.map((lead, index) => {
      // Hitung Summary
      summary.totalValuePipeline += lead.value;

      if (lead.status === LeadStatus.WON) {
        summary.countWon++;
        summary.totalRevenue += lead.value;
      } else if (lead.status === LeadStatus.LOST) {
        summary.countLost++;
      } else {
        summary.countOpen++;
      }

      // Helper format tanggal (Tampilkan dalam format Lokal User)
      const formatDate = (date: Date | null) => {
        if (!date) return '-';
        // Paksa tampilan ke 'id-ID' supaya user melihat tanggal sesuai jam WIB dia
        return new Date(date).toLocaleDateString('id-ID', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        }).split('/').reverse().join('-'); // Format YYYY-MM-DD
      };

      const formatStatus = (status: string) => {
        return status
          .replace(/_/g, ' ')
          .toLowerCase()
          .replace(/\b\w/g, c => c.toUpperCase());
      };

      let displayDate = '-';
      if (lead.status === LeadStatus.WON && lead.wonAt) {
        displayDate = formatDate(lead.wonAt);
      } else if (lead.status === LeadStatus.LOST && lead.lostAt) {
        displayDate = formatDate(lead.lostAt);
      }

      return {
        no: index + 1,
        id: lead.id,
        title: lead.title,
        company: lead.company || '-',
        contacts: lead.contacts || '-',
        phone: lead.phone || '-',
        email: lead.email || '-',
        sourceOrigin: lead.sourceOrigin || '-',
        sourceChannel: lead.sourceChannel || '-',
        createdAt: formatDate(lead.createdAt), // Gunakan helper baru
        dueDate: formatDate(lead.dueDate),
        status: formatStatus(lead.status),
        value: lead.value,
        wonLostAt: displayDate, 
      };
    });

    return res.status(200).json({
      success: true,
      filter: { 
        viewType, 
        period: viewType === 'MONTHLY' ? `${month}-${year}` : `Q${quarter}-${year}`,
        dateRange: {
            start: startDate.toISOString(),
            end: endDate.toISOString()
        }
      },
      summary: summary,
      data: formattedData,
    });

  } catch (error) {
    console.error("Error Report:", error);
    return res.status(500).json({ success: false, message: 'Gagal mengambil data laporan.' });
  }
};