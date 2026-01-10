import { Request, Response } from 'express';
import { PrismaClient, LeadStatus } from '@prisma/client';

const prisma = new PrismaClient();

// Interface untuk Request yang sudah ditempel user oleh Middleware
interface AuthRequest extends Request {
  user?: {
    userId: string;
    role: string;
    email: string;  
  };
}

export const getSalesReport = async (req: AuthRequest, res: Response) => {
  try {
    const { viewType, year, month, quarter } = req.body;
    
    // 1. AMBIL DATA USER DARI TOKEN (Middleware)
    const user = req.user; 
    
    if (!user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    // 2. Base Condition
    let whereCondition: any = {
      isArchived: false,
    };

    // ==========================================
    // LOGIKA FILTER PEMILIK (SANGAT PENTING)
    // ==========================================
    // Jika User BUKAN Admin, paksa filter hanya lead yang ditugaskan ke dia
    if (user.role !== 'ADMIN') {
      whereCondition.assignedUsers = {
        some: {
          id: user.userId // Cari lead di mana user ini ada dalam daftar assignedUsers
        }
      };
    }
    // Catatan: Jika ADMIN, filter ini tidak dipasang, jadi Admin bisa lihat semua.

    let orderByCondition: any = {};

    // ==========================================
    // LOGIKA 1: MODE BULANAN
    // ==========================================
    if (viewType === 'MONTHLY') {
      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 0, 23, 59, 59, 999);

      whereCondition = {
        ...whereCondition, // Gabungkan dengan filter assignedUsers di atas
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      };

      orderByCondition = { createdAt: 'asc' };
    } 
    
    // ==========================================
    // LOGIKA 2: MODE QUARTER
    // ==========================================
    else if (viewType === 'QUARTERLY') {
      const startMonthIndex = (quarter - 1) * 3;
      const startDate = new Date(year, startMonthIndex, 1);
      const endDate = new Date(year, startMonthIndex + 3, 0, 23, 59, 59, 999);

      whereCondition = {
        ...whereCondition, // Gabungkan dengan filter assignedUsers di atas
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
        // Opsional: Kita bisa include assignedUsers juga untuk memastikan
        assignedUsers: { select: { name: true } } 
      }
    });

    // 4. Hitung Summary (Sama seperti sebelumnya)
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

      // Helper format tanggal
      const formatDate = (date: Date | null) => date ? date.toISOString().split('T')[0] : '-';

      const formatStatus = (status: string) => {
        return status
          .replace(/_/g, ' ')             // Ganti underscore dengan spasi
          .toLowerCase()                  // Kecilkan semua huruf
          .replace(/\b\w/g, c => c.toUpperCase()); // Kapital huruf pertama tiap kata
      };

      // --- LOGIKA BARU UNTUK TANGGAL WON/LOST ---
      let displayDate = '-';

      // Cek 1: Jika Status WON, baru ambil wonAt
      if (lead.status === LeadStatus.WON && lead.wonAt) {
        displayDate = formatDate(lead.wonAt);
      } 
      // Cek 2: Jika Status LOST, baru ambil lostAt
      else if (lead.status === LeadStatus.LOST && lead.lostAt) {
        displayDate = formatDate(lead.lostAt);
      }
      // Jika statusnya NEGOTIATION/OPEN (meskipun dulu pernah ada wonAt), 
      // dia akan tetap '-' karena tidak masuk if di atas.

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
        createdAt: formatDate(lead.createdAt),
        dueDate: formatDate(lead.dueDate),
        
        status: formatStatus(lead.status),
        value: lead.value,
        
        // Gunakan variabel yang sudah divalidasi statusnya
        wonLostAt: displayDate, 
      };
    });

    return res.status(200).json({
      success: true,
      filter: { viewType, period: viewType === 'MONTHLY' ? `${month}-${year}` : `Q${quarter}-${year}` },
      summary: summary,
      data: formattedData,
    });

  } catch (error) {
    console.error("Error Report:", error);
    return res.status(500).json({ success: false, message: 'Gagal mengambil data laporan.' });
  }
};