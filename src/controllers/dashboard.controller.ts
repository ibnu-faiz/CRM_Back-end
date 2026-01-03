import { Request, Response } from 'express';
import prisma from '../config/database';

export const getDashboardStats = async (req: Request, res: Response): Promise<void> => {
  try {
    // 1. CEK USER DATA & VALIDASI
    // @ts-ignore
    const user = req.user; 
    
    // @ts-ignore
    const userId = user?.userId || user?.id || user?.sub;
    // @ts-ignore
    const userRole = user?.role;

    // Validasi Session Sales
    if (userRole === 'SALES' && !userId) {
       console.error(`[DashboardStats] Unauthorized access attempt by SALES role without ID.`);
       res.status(401).json({ error: "Invalid User Session: Missing ID" });
       return;
    }
    
    // 2. SETUP PARAMETER WAKTU (DINAMIS / CONTEXT SWITCHER)
    // Kita ambil parameter 'month' dan 'year' dari frontend
    const { range, month, year } = req.query; 
    const isAllTime = range === 'all';

    const now = new Date();
    
    // Tentukan Tahun & Bulan Target
    // Jika user kirim filter, pakai itu. Jika tidak, pakai waktu sekarang.
    const targetYear = year ? Number(year) : now.getFullYear();
    const targetMonth = month ? Number(month) : now.getMonth(); // 0 = Jan, 11 = Des

    let startDate: Date | undefined; 
    let endDate: Date | undefined; 
    
    let prevStartDate: Date | undefined;
    let prevEndDate: Date | undefined;

    if (!isAllTime) {
        // PERIODE UTAMA (Selected Month)
        // Tgl 1 bulan target
        startDate = new Date(targetYear, targetMonth, 1);
        // Tgl terakhir bulan target (trik: tanggal 0 bulan berikutnya)
        endDate = new Date(targetYear, targetMonth + 1, 0);

        // PERIODE PEMBANDING (Previous Month)
        // Javascript otomatis handle rollover tahun (misal Jan mundur jadi Des tahun lalu)
        prevStartDate = new Date(targetYear, targetMonth - 1, 1);
        prevEndDate = new Date(targetYear, targetMonth, 0);
    } else {
        // Logic All Time
        startDate = undefined; 
        prevStartDate = undefined; 
    }

    // 3. SETUP FILTER QUERY
    const baseFilter = (sDate: Date | undefined, eDate: Date | undefined) => {
        let condition: any = { isArchived: false };
        
        // Filter by Created Date (Inflow Metrics)
        if (sDate && eDate) {
            condition.createdAt = { gte: sDate, lte: eDate };
        }

        // Filter by Sales Role
        if (userRole === 'SALES') {
            condition.assignedUsers = {
                some: {
                    // Handle ID baik berupa Number maupun String (UUID)
                    id: !isNaN(Number(userId)) ? Number(userId) : userId
                }
            };
        }

        return condition;
    };

    const currentFilter = baseFilter(startDate, endDate);
    const prevFilter = baseFilter(prevStartDate, prevEndDate);

    // 4. EKSEKUSI DATABASE (PARALLEL)
    const [
        currPipeline, prevPipeline,
        currWon, prevWon,
        currLost, prevLost,
        currTotal, prevTotal
    ] = await Promise.all([
        // A. Pipeline Inflow (Menghitung semua lead baru di bulan terpilih)
        prisma.lead.aggregate({
            _sum: { value: true },
            _count: { id: true },
            where: currentFilter 
        }),
        prisma.lead.aggregate({
            _sum: { value: true },
            _count: { id: true },
            where: prevFilter 
        }),

        // B. Metrics Row (Won, Lost, Total)
        prisma.lead.count({ where: { ...currentFilter, status: 'WON' } }),
        prisma.lead.count({ where: { ...prevFilter, status: 'WON' } }),

        prisma.lead.count({ where: { ...currentFilter, status: 'LOST' } }),
        prisma.lead.count({ where: { ...prevFilter, status: 'LOST' } }),

        prisma.lead.count({ where: currentFilter }),
        prisma.lead.count({ where: prevFilter }),
    ]);

    // 5. KALKULASI PERSENTASE
    const calculateChange = (current: number, last: number) => {
        if (isAllTime) return 0;
        if (last === 0) return current > 0 ? 100 : 0;
        return Math.round(((current - last) / last) * 100);
    };

    // 6. OLAH DATA STATS
    const statsPipelineValue = Number(currPipeline._sum.value) || 0;
    const statsTotalNewLeads = Number(currPipeline._count.id) || 0;
    const statsAvgDeal = statsTotalNewLeads > 0 ? Math.round(statsPipelineValue / statsTotalNewLeads) : 0;

    const prevPipelineValue = Number(prevPipeline._sum.value) || 0;
    const prevTotalNewLeads = Number(prevPipeline._count.id) || 0;
    const prevAvgDeal = prevTotalNewLeads > 0 ? Math.round(prevPipelineValue / prevTotalNewLeads) : 0;

    const currConversionRate = currTotal > 0 ? Math.round((currWon / currTotal) * 100) : 0;
    const prevConversionRate = prevTotal > 0 ? Math.round((prevWon / prevTotal) * 100) : 0;

    // 7. RESPONSE JSON
    res.json({
      // Big Stats Cards
      pipelineValue: {
        value: statsPipelineValue,
        change: calculateChange(statsPipelineValue, prevPipelineValue),
        isPositive: calculateChange(statsPipelineValue, prevPipelineValue) >= 0
      },
      activeDeals: {
        value: statsTotalNewLeads, 
        change: calculateChange(statsTotalNewLeads, prevTotalNewLeads),
        isPositive: calculateChange(statsTotalNewLeads, prevTotalNewLeads) >= 0
      },
      avgDeal: {
        value: statsAvgDeal,
        change: calculateChange(statsAvgDeal, prevAvgDeal),
        isPositive: calculateChange(statsAvgDeal, prevAvgDeal) >= 0
      },
      // Detailed Metrics
      metrics: {
        totalWon: {
            value: currWon,
            change: calculateChange(currWon, prevWon),
            isPositive: calculateChange(currWon, prevWon) >= 0
        },
        totalLost: {
            value: currLost,
            change: calculateChange(currLost, prevLost),
            isPositive: false 
        },
        totalLeads: {
            value: currTotal,
            change: calculateChange(currTotal, prevTotal),
            isPositive: calculateChange(currTotal, prevTotal) >= 0
        },
        conversionRate: { 
            value: currConversionRate, 
            change: calculateChange(currConversionRate, prevConversionRate),
            isPositive: calculateChange(currConversionRate, prevConversionRate) >= 0
        }
      }
    });

  } catch (error) {
    console.error("[DashboardStats] Internal Server Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const getLeadsChart = async (req: Request, res: Response): Promise<void> => {
  try {
    // 1. CEK USER DATA (Logic Robust yang sama dengan getDashboardStats)
    // @ts-ignore
    const user = req.user;
    // @ts-ignore
    const userId = user?.userId || user?.id || user?.sub;
    // @ts-ignore
    const userRole = user?.role;

    // 2. SETUP PARAMETER WAKTU (YEARLY CONTEXT)
    // Ambil parameter 'year' saja. Abaikan 'month'.
    const { year } = req.query;
    
    const now = new Date();
    // Jika user kirim tahun, pakai itu. Jika tidak, pakai tahun ini.
    const targetYear = year ? Number(year) : now.getFullYear();

    // Tentukan Range: 1 Jan 00:00 s/d 31 Des 23:59 pada tahun target
    const startOfYear = new Date(targetYear, 0, 1);
    const endOfYear = new Date(targetYear, 11, 31, 23, 59, 59);

    // 3. FILTER QUERY
    const whereCondition: any = {
      isArchived: false,
      createdAt: {
        gte: startOfYear,
        lte: endOfYear,
      },
    };

    // Filter Sales (Safe ID Check)
    if (userRole === 'SALES') {
        whereCondition.assignedUsers = {
          some: {
             id: !isNaN(Number(userId)) ? Number(userId) : userId
          }
        };
    }

    // 4. AMBIL DATA DARI DB
    const leads = await prisma.lead.findMany({
      where: whereCondition,
      select: { createdAt: true }, // Kita cuma butuh tanggalnya untuk grouping
    });

    // 5. PROSES GROUPING BY MONTH
    // Inisialisasi array 12 bulan
    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
    ];
    
    // Siapkan wadah data awal (semua 0)
    const chartData = months.map(month => ({ name: month, total: 0 }));

    // Looping data leads dan masukkan ke keranjang bulan yang sesuai
    leads.forEach(lead => {
      // Pastikan tanggal lead dibaca sebagai object Date
      const date = new Date(lead.createdAt);
      // Ambil index bulan (0-11)
      const monthIndex = date.getMonth();
      
      // Safety check: pastikan index valid
      if (chartData[monthIndex]) {
          chartData[monthIndex].total += 1;
      }
    });

    res.json(chartData);

  } catch (error) {
    console.error("[LeadsChart] Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const getRevenueChart = async (req: Request, res: Response): Promise<void> => {
  try {
    // 1. CEK USER DATA
    // @ts-ignore
    const user = req.user;
    // @ts-ignore
    const userId = user?.userId || user?.id || user?.sub;
    // @ts-ignore
    const userRole = user?.role;

    // 2. SETUP TAHUN
    const { year } = req.query;
    const targetYear = year ? Number(year) : new Date().getFullYear();

    // 3. ARRAY 12 BULAN (0-11)
    const months = Array.from({ length: 12 }, (_, i) => i);

    // 4. SIAPKAN FILTER USER (Agar bisa dipakai berulang)
    const userFilter: any = {};
    if (userRole === 'SALES') {
      userFilter.assignedUsers = {
        some: {
          id: !isNaN(Number(userId)) ? Number(userId) : userId
        }
      };
    }

    // 5. LOOP QUERY PARALEL (PROMISE ALL)
    // Kita query database 12x (paralel) agar akurat memisahkan CreatedAt vs WonAt
    const chartData = await Promise.all(
      months.map(async (monthIndex) => {
        
        // Tentukan Awal & Akhir Bulan
        const startDate = new Date(targetYear, monthIndex, 1);
        const endDate = new Date(targetYear, monthIndex + 1, 0, 23, 59, 59, 999);
        const monthName = startDate.toLocaleString('default', { month: 'short' }); // Jan, Feb...

        // --- A. HITUNG ESTIMATION (POTENSI) ---
        // Logic: Berdasarkan createdAt (Kapan lead masuk).
        // Syarat: Semua status (Won, Lost, Open) dihitung sebagai Total Opportunity.
        const estimation = await prisma.lead.aggregate({
          _sum: { value: true },
          where: {
            ...userFilter,    // Filter User
            isArchived: false,
            createdAt: {      // KUNCI: Filter by CreatedAt
              gte: startDate,
              lte: endDate
            }
          }
        });

        // --- B. HITUNG REALISATION (UANG MASUK) ---
        // Logic: Berdasarkan wonAt (Kapan deal terjadi).
        // Syarat: Status WON.
        const realisation = await prisma.lead.aggregate({
          _sum: { value: true },
          where: {
            ...userFilter,    // Filter User
            status: 'WON',    // Wajib WON
            isArchived: false,
            
            // KUNCI: Filter by WonAt (Bukan CreatedAt)
            // Pastikan field ini ada. Jika belum ada, pakai updatedAt (dengan risiko)
            wonAt: {          
              gte: startDate,
              lte: endDate
            }
          }
        });

        return {
          month: monthName,
          estimation: Number(estimation._sum.value) || 0,
          realisation: Number(realisation._sum.value) || 0
        };
      })
    );

    res.json(chartData);

  } catch (error) {
    console.error("[RevenueChart] Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const getRecentDeals = async (req: Request, res: Response): Promise<void> => {
  try {
    // 1. CEK USER DATA
    // @ts-ignore
    const user = req.user;
    // @ts-ignore
    const userId = user?.userId || user?.id || user?.sub;
    // @ts-ignore
    const userRole = user?.role;

    // 2. TANGKAP PARAMETER
    const { month, year, range } = req.query; // <--- Tambah range

    // Base Filter (Archived selalu false)
    const whereCondition: any = {
      isArchived: false,
    };

    // 3. LOGIC STRICT FILTER vs ALL TIME
    // Jika range BUKAN 'all', baru kita batasi tanggalnya
    if (range !== 'all') {
        const now = new Date();
        const targetYear = year ? Number(year) : now.getFullYear();
        const targetMonth = month ? Number(month) : now.getMonth();

        // Tgl 1 s/d Akhir Bulan
        const startDate = new Date(targetYear, targetMonth, 1);
        const endDate = new Date(targetYear, targetMonth + 1, 0, 23, 59, 59);

        // Tambahkan filter tanggal ke whereCondition
        whereCondition.createdAt = {
            gte: startDate,
            lte: endDate
        };
    }

    // 4. FILTER ROLE SALES
    if (userRole === 'SALES') {
       whereCondition.assignedUsers = {
          some: {
             id: !isNaN(Number(userId)) ? Number(userId) : userId
          }
       };
    }

    // 5. AMBIL DATA
    // Logic: Ambil 5 data teratas, diurutkan dari yang paling baru dibuat
    const deals = await prisma.lead.findMany({
      where: whereCondition,
      orderBy: { createdAt: 'desc' }, 
      take: 5,
      select: {
        id: true,
        title: true,
        value: true,
        status: true,
        createdAt: true 
      }
    });

    res.json(deals);
  } catch (error) {
    console.error("[RecentDeals] Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const getPipelineStats = async (req: Request, res: Response): Promise<void> => {
  try {
    // ... (User logic sama)
    // @ts-ignore
    const userRole = req.user?.role;
    // @ts-ignore
    const userId = req.user?.userId;

    // TANGKAP RANGE
    const { month, year, range } = req.query; // <--- Tambah range

    const whereCondition: any = { isArchived: false };

    // HANYA FILTER TANGGAL JIKA RANGE BUKAN 'ALL'
    if (range !== 'all') {
        const now = new Date();
        const targetYear = year ? Number(year) : now.getFullYear();
        const targetMonth = month ? Number(month) : now.getMonth();
        const startDate = new Date(targetYear, targetMonth, 1);
        const endDate = new Date(targetYear, targetMonth + 1, 0, 23, 59, 59);

        // Pasang filter tanggal
        whereCondition.createdAt = { gte: startDate, lte: endDate };
    }

    // ... (Sisa logic Sales filter & prisma query sama persis)
    if (userRole === 'SALES') {
       whereCondition.assignedUsers = { some: { id: !isNaN(Number(userId)) ? Number(userId) : userId } };
    }

    const stats = await prisma.lead.groupBy({
      by: ['status'],
      where: whereCondition,
      _count: { id: true },
    });
    
    // ... (Format response sama)
    const formattedStats = stats.map(item => ({ status: item.status, count: item._count.id }));
    res.json(formattedStats);

  } catch (error) {
     // ...
  }
};

export const getLeadsSourceChart = async (req: Request, res: Response): Promise<void> => {
  try {
    // ... (User logic sama)
    // @ts-ignore
    const userRole = req.user?.role;
    // @ts-ignore
    const userId = req.user?.userId;

    const { month, year, range } = req.query; // <--- Tambah range

    const whereCondition: any = { isArchived: false };

    // LOGIC FILTER "ALL TIME"
    if (range !== 'all') {
        const now = new Date();
        const targetYear = year ? Number(year) : now.getFullYear();
        const targetMonth = month ? Number(month) : now.getMonth();
        const startDate = new Date(targetYear, targetMonth, 1);
        const endDate = new Date(targetYear, targetMonth + 1, 0, 23, 59, 59);

        whereCondition.createdAt = { gte: startDate, lte: endDate };
    }

    // ... (Sisa logic Sales filter & prisma query sama persis)
    if (userRole === 'SALES') {
       whereCondition.assignedUsers = { some: { id: !isNaN(Number(userId)) ? Number(userId) : userId } };
    }

    const sourceStats = await prisma.lead.groupBy({
      by: ['sourceOrigin'],
      where: whereCondition,
      _count: { id: true }
    });
    // ... (Format response sama)
    const chartData = sourceStats.map(item => ({ name: item.sourceOrigin || 'Unknown', value: item._count.id }));
    chartData.sort((a, b) => b.value - a.value);
    res.json(chartData);
  } catch (error) {
      // ...
  }
};

export const getQuarterSummary = async (req: Request, res: Response): Promise<void> => {
  try {
    // @ts-ignore
    const user = req.user;
    // @ts-ignore
    const userId = user?.userId || user?.id || user?.sub;
    // @ts-ignore
    const userRole = user?.role;

    const { month, year } = req.query;

    const now = new Date();
    // Gunakan filter user, atau default ke waktu saat ini
    const targetYear = year ? Number(year) : now.getFullYear();
    const targetMonth = month ? Number(month) : now.getMonth(); 

    // --- LOGIKA QUARTER (SUDAH BENAR) ---
    // Q1: Jan(0), Feb(1), Mar(2) -> Start Month 0
    const quarterStartMonth = Math.floor(targetMonth / 3) * 3;

    const startDate = new Date(targetYear, quarterStartMonth, 1);
    // Trik mendapatkan detik terakhir di bulan ke-3 dari quarter
    const endDate = new Date(targetYear, quarterStartMonth + 3, 0, 23, 59, 59, 999);

    const quarterNumber = (quarterStartMonth / 3) + 1;

    // --- FILTER DATABASE ---
    const whereClause: any = {
      status: 'WON',
      // SARAN: Hapus isArchived: false jika ingin melihat history lama yang sudah diarsip
      // isArchived: false, 
      
      // PERBAIKAN: Gunakan wonAt agar data tidak berpindah saat diedit
      wonAt: {
        gte: startDate,
        lte: endDate,
      },
      // JIKA TERPAKSA pakai updatedAt, sadari risikonya data pindah quarter saat diedit
    };

    if (userRole === 'SALES') {
      whereClause.assignedUsers = {
        some: {
          id: !isNaN(Number(userId)) ? Number(userId) : userId
        }
      };
    }

    const result = await prisma.lead.aggregate({
      _sum: { value: true },
      _count: { id: true },
      where: whereClause,
    });

    const totalRevenue = Number(result._sum.value) || 0;
    const totalDeals = Number(result._count.id) || 0;
    const averageSize = totalDeals > 0 ? Math.round(totalRevenue / totalDeals) : 0;

    res.json({
      quarter: quarterNumber,
      year: targetYear,
      // Kirim label tanggal agar frontend tau range pastinya
      rangeLabel: `${startDate.toLocaleString('default', { month: 'short' })} - ${endDate.toLocaleString('default', { month: 'short' })}`,
      data: {
        revenue: totalRevenue,
        deals: totalDeals,
        average: averageSize
      }
    });

  } catch (error) {
    console.error("[QuarterSummary] Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const getDashboardSchedule = async (req: Request, res: Response): Promise<void> => {
  try {
    // 1. SETUP AUTH & USER CONTEXT
    // @ts-ignore
    const user = req.user;
    // @ts-ignore
    const userId = user?.userId || user?.id; // Handle variasi struktur token
    // @ts-ignore
    const userRole = user?.role;

    // 2. SETUP WAKTU (START OF TODAY)
    const now = new Date();
    // Reset jam ke 00:00:00 agar activity hari ini tetap masuk walau jamnya sudah lewat sedikit
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // 3. LOGIC FILTER UTAMA
    const whereCondition: any = {
      isCompleted: false, // SYARAT MUTLAK: Hanya yang statusnya Open/Unpaid
      
      // LOGIC COMBINATION (OR)
      OR: [
        // A. ACTIVITY BIASA (Meeting, Call, Task)
        // Ambil yang jadwalnya HARI INI atau MASA DEPAN.
        // Activity masa lalu yang lupa di-close TIDAK dimunculkan agar dashboard bersih.
        { 
          AND: [
            { scheduledAt: { gte: startOfToday } },
            { type: { not: 'INVOICE' } } // Kecuali invoice, karena invoice punya logic sendiri
          ]
        },

        // B. INVOICE (SOLUSI MASALAH KAMU)
        // Ambil SEMUA Invoice yang belum lunas.
        // Tidak peduli tanggalnya (Overdue/Masa Lalu tetap muncul untuk ditagih).
        { type: 'INVOICE' },

        // C. DRAFT EMAIL
        // Email yang belum dikirim dan belum punya jadwal spesifik.
        { 
          AND: [
            { type: 'EMAIL' },
            { scheduledAt: null }
          ]
        }
      ]
    };

    // 4. FILTER ROLE SALES
    // Jika user adalah SALES, pastikan hanya melihat data miliknya sendiri
    if (userRole === 'SALES') {
      whereCondition.AND = [
        {
          OR: [
            { createdById: userId }, // Yang dia buat sendiri
            { lead: { assignedUsers: { some: { id: userId } } } } // Atau lead yang di-assign ke dia
          ]
        }
      ];
    }

    // 5. EKSEKUSI QUERY
    const activities = await prisma.leadActivity.findMany({
      where: whereCondition,
      
      // URUTAN TAMPILAN:
      orderBy: [
        // 1. Prioritaskan berdasarkan jadwal terdekat (Overdue invoice akan muncul paling atas karena tanggalnya lama)
        { scheduledAt: 'asc' }, 
        // 2. Jika jadwal sama, lihat kapan dibuat
        { createdAt: 'desc' }
      ],
      
      take: 20, // Limit agar tidak berat

      // STRUKTUR DATA (SAMA PERSIS DENGAN getAllActivities)
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
            avatar: true
          }
        },
        lead: {
          select: {
            id: true,
            company: true,  
            contacts: true,
            isArchived: true,
            status: true,
            assignedUsers: {
              select: {
                id: true,
                name: true,
                role: true
              }
            }
          }
        }
      }
    });

    // 6. RETURN RESPONSE
    res.json(activities);

  } catch (error) {
    console.error("[getDashboardSchedule] Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};