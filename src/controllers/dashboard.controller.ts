import { Request, Response } from 'express';
import prisma from '../config/database';

export const getDashboardStats = async (req: Request, res: Response): Promise<void> => {
  try {
    // @ts-ignore
    const userId = req.user?.userId || req.user?.id;
    // @ts-ignore
    const userRole = req.user?.role;
    
    // 1. TANGKAP PARAMETER FILTER (Default: 'month')
    const { range } = req.query; 
    const isAllTime = range === 'all';

    // 2. SETUP TANGGAL
    const now = new Date();
    let startDate: Date | undefined; // Kalau undefined berarti dari awal jaman (All Time)
    let endDate = new Date(); // Sampai detik ini
    
    let prevStartDate: Date | undefined;
    let prevEndDate: Date | undefined;

    if (!isAllTime) {
        // Logika "Current Month"
        startDate = new Date(now.getFullYear(), now.getMonth(), 1); // Tgl 1 bulan ini
        endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0); // Tgl terakhir bulan ini

        // Logika "Last Month" (Untuk hitung % change)
        prevStartDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        prevEndDate = new Date(now.getFullYear(), now.getMonth(), 0);
    } else {
        // Logika "All Time" -> Tidak ada start date, tidak ada previous date
        startDate = undefined; 
        prevStartDate = undefined; 
    }

    // 3. SETUP FILTER DASAR (Role & Tanggal)
    const baseFilter = (sDate: Date | undefined, eDate: Date | undefined) => {
        let condition: any = {
          isArchived: false
        };
        
        // Filter Tanggal
        if (sDate && eDate) {
            condition.createdAt = { gte: sDate, lte: eDate };
        }

        // --- REVISI LOGIC SALES DISINI ---
        if (userRole === 'SALES') {
            // Ganti assignedToId dengan assignedUsers logic
            condition.assignedUsers = {
                some: {
                    id: userId // Pastikan userId bertipe Number/Int
                }
            };
        }

        return condition;
    };

    const currentFilter = baseFilter(startDate, endDate);
    const prevFilter = baseFilter(prevStartDate, prevEndDate);

    // 4. EKSEKUSI QUERY DATABASE (PARALLEL)
    // Kita butuh banyak data, jadi kita jalankan serentak biar cepat
    const [
        // A. Stats Utama (Pipeline)
        currPipeline, prevPipeline,
        
        // B. Metrics Row (Won, Lost, Total Leads)
        currWon, prevWon,
        currLost, prevLost,
        currTotal, prevTotal
    ] = await Promise.all([
        // A. Pipeline Queries (Status Aktif saja)
        prisma.lead.aggregate({
            _sum: { value: true },
            _count: { id: true },
            where: { ...currentFilter, status: { notIn: ['WON', 'LOST'] } }
        }),
        prisma.lead.aggregate({
            _sum: { value: true },
            _count: { id: true },
            where: { ...prevFilter, status: { notIn: ['WON', 'LOST'] } }
        }),

        // B. Metrics Queries
        // 1. Total Won
        prisma.lead.count({ where: { ...currentFilter, status: 'WON' } }),
        prisma.lead.count({ where: { ...prevFilter, status: 'WON' } }),

        // 2. Total Lost
        prisma.lead.count({ where: { ...currentFilter, status: 'LOST' } }),
        prisma.lead.count({ where: { ...prevFilter, status: 'LOST' } }),

        // 3. Total Leads (Semua status masuk)
        prisma.lead.count({ where: currentFilter }),
        prisma.lead.count({ where: prevFilter }),
    ]);

    // 5. FUNGSI HITUNG PERSENTASE
    const calculateChange = (current: number, last: number) => {
        if (isAllTime) return 0; // Kalau All Time, tidak ada kenaikan/penurunan
        if (last === 0) return current > 0 ? 100 : 0;
        return Math.round(((current - last) / last) * 100);
    };

    // 6. OLAH DATA UTAMA (PIPELINE)
    const statsPipelineValue = Number(currPipeline._sum.value) || 0;
    const statsActiveDeals = Number(currPipeline._count.id) || 0;
    const statsAvgDeal = statsActiveDeals > 0 ? Math.round(statsPipelineValue / statsActiveDeals) : 0;

    const prevPipelineValue = Number(prevPipeline._sum.value) || 0;
    const prevActiveDeals = Number(prevPipeline._count.id) || 0;
    const prevAvgDeal = prevActiveDeals > 0 ? Math.round(prevPipelineValue / prevActiveDeals) : 0;

    // 7. OLAH DATA METRICS (METRICS ROW)
    // Conversion Rate = (Won / Total Leads) * 100
    const currConversionRate = currTotal > 0 ? Math.round((currWon / currTotal) * 100) : 0;
    const prevConversionRate = prevTotal > 0 ? Math.round((prevWon / prevTotal) * 100) : 0;

    // 8. RESPONSE JSON LENGKAP
    res.json({
      // Bagian Atas (Big Stats)
      pipelineValue: {
        value: statsPipelineValue,
        change: calculateChange(statsPipelineValue, prevPipelineValue),
        isPositive: calculateChange(statsPipelineValue, prevPipelineValue) >= 0
      },
      activeDeals: {
        value: statsActiveDeals,
        change: calculateChange(statsActiveDeals, prevActiveDeals),
        isPositive: calculateChange(statsActiveDeals, prevActiveDeals) >= 0
      },
      avgDeal: {
        value: statsAvgDeal,
        change: calculateChange(statsAvgDeal, prevAvgDeal),
        isPositive: calculateChange(statsAvgDeal, prevAvgDeal) >= 0
      },

      // Bagian Bawah (Metrics Row)
      metrics: {
        totalWon: {
            value: currWon,
            change: calculateChange(currWon, prevWon),
            isPositive: calculateChange(currWon, prevWon) >= 0
        },
        totalLost: {
            value: currLost,
            change: calculateChange(currLost, prevLost),
            isPositive: false // Lost naik = Negatif (bad thing)
        },
        totalLeads: {
            value: currTotal,
            change: calculateChange(currTotal, prevTotal),
            isPositive: calculateChange(currTotal, prevTotal) >= 0
        },
        conversionRate: { // Pengganti Active Leads
            value: currConversionRate, // Ini persen (misal: 25)
            change: calculateChange(currConversionRate, prevConversionRate),
            isPositive: calculateChange(currConversionRate, prevConversionRate) >= 0
        }
      }
    });

  } catch (error) {
    console.error("Dashboard Stats Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const getLeadsChart = async (req: Request, res: Response): Promise<void> => {
  try {
    // @ts-ignore
    const userId = req.user?.userId;
    // @ts-ignore
    const userRole = req.user?.role;

    // 1. Tentukan Range Tahun Ini (Jan 1 - Dec 31)
    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const endOfYear = new Date(now.getFullYear(), 11, 31);

    // 2. Filter (Jika sales, cuma liat data sendiri)
    const whereCondition: any = {
      isArchived: false,
      createdAt: {
        gte: startOfYear,
        lte: endOfYear,
      },
    };

    if (userRole === 'SALES') {
       whereCondition.assignedUsers = {
          some: {
             id: userId
          }
       };
    }

    // 3. Ambil Data Raw dari DB
    const leads = await prisma.lead.findMany({
      where: whereCondition,
      select: { createdAt: true }, // Kita cuma butuh tanggalnya
    });

    // 4. Proses Grouping by Month (Javascript Logic)
    // Inisialisasi array 12 bulan dengan nilai 0
    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
    ];
    
    // Siapkan wadah data
    const chartData = months.map(month => ({ name: month, total: 0 }));

    // Looping data leads dan masukkan ke keranjang bulan yang sesuai
    leads.forEach(lead => {
      const monthIndex = new Date(lead.createdAt).getMonth(); // 0 = Jan, 1 = Feb
      chartData[monthIndex].total += 1;
    });

    res.json(chartData);

  } catch (error) {
    console.error("Leads Chart Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const getRevenueChart = async (req: Request, res: Response): Promise<void> => {
  try {
    // @ts-ignore
    const userId = req.user?.userId;
    // @ts-ignore
    const userRole = req.user?.role;

    // 1. Filter Tahun Ini
    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const endOfYear = new Date(now.getFullYear(), 11, 31);

    const whereCondition: any = {
      isArchived: false,
      createdAt: { gte: startOfYear, lte: endOfYear },
    };

    if (userRole === 'SALES') {
       whereCondition.assignedUsers = {
          some: {
             id: userId
          }
       };
    }

    // 2. Ambil Data (Value, Status, Tanggal)
    const leads = await prisma.lead.findMany({
      where: whereCondition,
      select: {
        value: true,
        status: true,
        createdAt: true,
      },
    });

    // 3. Logic Pengelompokan Bulan
    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
    ];

    // Siapkan wadah awal (semua 0)
    const chartData = months.map(month => ({ 
      month: month, 
      estimation: 0, 
      realisation: 0 
    }));

    // 4. Loop Logic (The Core Logic)
    leads.forEach(lead => {
      const monthIndex = new Date(lead.createdAt).getMonth();
      const val = Number(lead.value) || 0;

      // LOGIC REALISATION: Hanya yang WON
      if (lead.status === 'WON') {
        chartData[monthIndex].realisation += val;
      }

      // LOGIC ESTIMATION: Semua KECUALI yang LOST
      if (lead.status !== 'LOST') {
        chartData[monthIndex].estimation += val;
      }
    });

    res.json(chartData);

  } catch (error) {
    console.error("Revenue Chart Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const getRecentDeals = async (req: Request, res: Response): Promise<void> => {
  try {
    // @ts-ignore
    const userId = req.user?.userId;
    // @ts-ignore
    const userRole = req.user?.role;

    const whereCondition: any = {
      isArchived: false
    };

    // Filter Khusus Sales (Hanya lead yang ditugaskan ke dia)
    if (userRole === 'SALES') {
       whereCondition.assignedUsers = {
          some: { id: userId }
       };
    }

    const deals = await prisma.lead.findMany({
      where: whereCondition,
      orderBy: { updatedAt: 'desc' }, // Urutkan dari yang paling baru disentuh
      take: 5, // Ambil 5 saja
      select: {
        id: true,
        title: true, // <--- CEK SCHEMA: Ganti jadi 'name' kalau kolomnya 'name'
        value: true,
        status: true,
      }
    });

    res.json(deals);
  } catch (error) {
    console.error("Recent Deals Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const getPipelineStats = async (req: Request, res: Response): Promise<void> => {
  try {
    // @ts-ignore
    const userId = req.user?.userId;
    // @ts-ignore
    const userRole = req.user?.role;

    // 1. Filter Dasar
    // HAPUS baris "status: { not: 'LOST' }"
    // Kita biarkan kosong {} agar SEMUA status (termasuk LOST) terambil
    const whereCondition: any = {
      isArchived: false,
    }; 

    // 2. Filter Sales (Logic assignedUsers)
    if (userRole === 'SALES') {
       whereCondition.assignedUsers = {
          some: { id: userId }
       };
    }

    // 3. Hitung Grouping
    const stats = await prisma.lead.groupBy({
      by: ['status'],
      where: whereCondition,
      _count: {
        id: true 
      },
    });

    res.json(stats);

  } catch (error) {
    console.error("Pipeline Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const getDashboardActivities = async (req: Request, res: Response): Promise<void> => {
  try {
    // @ts-ignore
    const userId = req.user?.userId;
    
    // Setup Waktu Hari Ini (00:00 - 23:59)
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    // Filter User: Hanya ambil aktivitas milik user ini (atau timnya jika Manager)
    // Untuk simpelnya, kita ambil milik user sendiri dulu
    const whereUser = { createdById: userId };

    // 1. QUERY TODAY ACTIVITIES
    const todayRaw = await prisma.leadActivity.findMany({
      where: {
        ...whereUser,
        scheduledAt: {
          gte: startOfToday,
          lte: endOfToday
        },
        isCompleted: false // Jangan tampilkan yang sudah selesai
      },
      orderBy: { scheduledAt: 'asc' },
      include: {
        lead: { select: { title: true, contacts: true } } // Ambil info lead terkait
      }
    });

    // 2. QUERY UPCOMING ACTIVITIES (Besok ke atas)
    const upcomingRaw = await prisma.leadActivity.findMany({
      where: {
        ...whereUser,
        scheduledAt: {
          gt: endOfToday // Lebih besar dari hari ini
        },
        isCompleted: false
      },
      orderBy: { scheduledAt: 'asc' },
      take: 5, // Batasi 5 saja biar tidak kepanjangan
      include: {
        lead: { select: { title: true } }
      }
    });

    // Helper Format Jam (03:00 PM)
    const formatTime = (date: Date | null) => {
      if (!date) return '-';
      return new Intl.DateTimeFormat('en-US', { 
        hour: '2-digit', minute: '2-digit', hour12: true 
      }).format(date);
    };

    // Helper Format Tanggal (Tomorrow / 19/11/2025)
    const formatDate = (date: Date) => {
      const tomorrow = new Date(startOfToday);
      tomorrow.setDate(tomorrow.getDate() + 1);

      // Cek apakah besok
      if (date >= tomorrow && date < new Date(tomorrow.getTime() + 86400000)) {
        return 'Tomorrow';
      }
      // Kalau bukan besok, tampilkan tanggal biasa
      return new Intl.DateTimeFormat('en-GB').format(date); // DD/MM/YYYY
    };

    // 3. MAPPING DATA UNTUK FRONTEND
    const response = {
      today: todayRaw.map(act => ({
        id: act.id,
        type: act.type.toLowerCase(), // MEETING -> meeting
        title: act.title || act.lead.title, // Pakai judul aktivitas, kalau kosong pakai nama Lead
        time: formatTime(act.scheduledAt),
        location: act.location || 'Online',
        attendees: act.lead.contacts ? `With: ${act.lead.contacts}` : 'Internal',
      })),
      upcoming: upcomingRaw.map(act => ({
        id: act.id,
        type: act.type.toLowerCase(),
        title: act.title || 'Untitled Activity',
        description: act.description || `Follow up for ${act.lead.title}`,
        time: formatTime(act.scheduledAt),
        date: formatDate(act.scheduledAt!) // Tanda seru karena kita yakin scheduledAt ada (hasil filter DB)
      }))
    };

    res.json(response);

  } catch (error) {
    console.error("Activity Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const getLeadsSourceChart = async (req: Request, res: Response): Promise<void> => {
  try {
    // @ts-ignore
    const userId = req.user?.userId;
    // @ts-ignore
    const userRole = req.user?.role;

    const whereCondition: any = {
      isArchived: false,
    };

    // 1. Filter Sales (Hanya data milik dia)
    if (userRole === 'SALES') {
       whereCondition.assignedUsers = {
          some: { id: userId }
       };
    }

    // 2. Grouping by Source Origin
    // Kita hitung berapa banyak leads untuk setiap kategori (Social Media, Website, dll)
    const sourceStats = await prisma.lead.groupBy({
      by: ['sourceOrigin'],
      where: whereCondition,
      _count: {
        id: true
      }
    });

    // 3. Formatting Data untuk Frontend
    // Hasil groupBy prisma itu: [{ sourceOrigin: 'Social Media', _count: { id: 10 } }]
    // Kita ubah jadi: [{ name: 'Social Media', value: 10 }]
    const chartData = sourceStats.map(item => ({
      name: item.sourceOrigin || 'Unknown', // Handle kalau null
      value: item._count.id
    }));

    // Urutkan dari yang terbanyak biar Pie Chart rapi
    chartData.sort((a, b) => b.value - a.value);

    res.json(chartData);

  } catch (error) {
    console.error("Leads Source Chart Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};