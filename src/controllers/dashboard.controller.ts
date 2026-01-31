import { Request, Response } from 'express';
import prisma from '../config/database';

const getWIBDate = (year: number, month: number, day: number, hours = 0, minutes = 0, seconds = 0, ms = 0) => {
    const date = new Date(year, month, day, hours, minutes, seconds, ms);
    date.setHours(date.getHours() - 7); // Offset -7 Jam
    return date;
};

export const getDashboardStats = async (req: Request, res: Response): Promise<void> => {
  try {
    // @ts-ignore
    const user = req.user; 
    // @ts-ignore
    const userId = user?.userId || user?.id || user?.sub;
    // @ts-ignore
    const userRole = user?.role;

    if (userRole === 'SALES' && !userId) {
       res.status(401).json({ error: "Invalid User Session: Missing ID" });
       return;
    }
    
    const { range, month, year } = req.query; 
    const isAllTime = range === 'all';
    const now = new Date();
    
    const targetYear = year ? Number(year) : now.getFullYear();
    const targetMonth = (month !== undefined && month !== null) ? Number(month) : now.getMonth();

    let startDate: Date | undefined; 
    let endDate: Date | undefined; 
    let prevStartDate: Date | undefined;
    let prevEndDate: Date | undefined;

    if (!isAllTime) {
        // PERIODE UTAMA (Pakai Helper WIB)
        startDate = getWIBDate(targetYear, targetMonth, 1);
        endDate = getWIBDate(targetYear, targetMonth + 1, 0, 23, 59, 59, 999);

        // PERIODE PEMBANDING
        prevStartDate = getWIBDate(targetYear, targetMonth - 1, 1);
        prevEndDate = getWIBDate(targetYear, targetMonth, 0, 23, 59, 59, 999);
    }

    const baseFilter = (sDate: Date | undefined, eDate: Date | undefined) => {
        let condition: any = { isArchived: false };
        if (sDate && eDate) condition.createdAt = { gte: sDate, lte: eDate };
        if (userRole === 'SALES') condition.assignedUsers = { some: { id: !isNaN(Number(userId)) ? Number(userId) : userId } };
        return condition;
    };

    const currentFilter = baseFilter(startDate, endDate);
    const prevFilter = baseFilter(prevStartDate, prevEndDate);

    const [currPipeline, prevPipeline, currWon, prevWon, currLost, prevLost, currTotal, prevTotal] = await Promise.all([
        prisma.lead.aggregate({ _sum: { value: true }, _count: { id: true }, where: currentFilter }),
        prisma.lead.aggregate({ _sum: { value: true }, _count: { id: true }, where: prevFilter }),
        prisma.lead.count({ where: { ...currentFilter, status: 'WON' } }),
        prisma.lead.count({ where: { ...prevFilter, status: 'WON' } }),
        prisma.lead.count({ where: { ...currentFilter, status: 'LOST' } }),
        prisma.lead.count({ where: { ...prevFilter, status: 'LOST' } }),
        prisma.lead.count({ where: currentFilter }),
        prisma.lead.count({ where: prevFilter }),
    ]);

    const calculateChange = (current: number, last: number) => {
        if (isAllTime) return 0;
        if (last === 0) return current > 0 ? 100 : 0;
        return Math.round(((current - last) / last) * 100);
    };

    const statsPipelineValue = Number(currPipeline._sum.value) || 0;
    const statsTotalNewLeads = Number(currPipeline._count.id) || 0;
    const statsAvgDeal = statsTotalNewLeads > 0 ? Math.round(statsPipelineValue / statsTotalNewLeads) : 0;
    const prevPipelineValue = Number(prevPipeline._sum.value) || 0;
    const prevTotalNewLeads = Number(prevPipeline._count.id) || 0;
    const prevAvgDeal = prevTotalNewLeads > 0 ? Math.round(prevPipelineValue / prevTotalNewLeads) : 0;
    const currConversionRate = currTotal > 0 ? Math.round((currWon / currTotal) * 100) : 0;
    const prevConversionRate = prevTotal > 0 ? Math.round((prevWon / prevTotal) * 100) : 0;

    res.json({
      pipelineValue: { value: statsPipelineValue, change: calculateChange(statsPipelineValue, prevPipelineValue), isPositive: calculateChange(statsPipelineValue, prevPipelineValue) >= 0 },
      activeDeals: { value: statsTotalNewLeads, change: calculateChange(statsTotalNewLeads, prevTotalNewLeads), isPositive: calculateChange(statsTotalNewLeads, prevTotalNewLeads) >= 0 },
      avgDeal: { value: statsAvgDeal, change: calculateChange(statsAvgDeal, prevAvgDeal), isPositive: calculateChange(statsAvgDeal, prevAvgDeal) >= 0 },
      metrics: {
        totalWon: { value: currWon, change: calculateChange(currWon, prevWon), isPositive: calculateChange(currWon, prevWon) >= 0 },
        totalLost: { value: currLost, change: calculateChange(currLost, prevLost), isPositive: false },
        totalLeads: { value: currTotal, change: calculateChange(currTotal, prevTotal), isPositive: calculateChange(currTotal, prevTotal) >= 0 },
        conversionRate: { value: currConversionRate, change: calculateChange(currConversionRate, prevConversionRate), isPositive: calculateChange(currConversionRate, prevConversionRate) >= 0 }
      }
    });

  } catch (error) {
    console.error("[DashboardStats] Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const getLeadsChart = async (req: Request, res: Response): Promise<void> => {
  try {
    // @ts-ignore
    const user = req.user;
    // @ts-ignore
    const userId = user?.userId || user?.id || user?.sub;
    // @ts-ignore
    const userRole = user?.role;

    const { year } = req.query;
    const now = new Date();
    const targetYear = year ? Number(year) : now.getFullYear();

    // 🔥 FIX: Pakai Helper WIB
    // Mulai: 1 Jan 00:00 (Mundur 7 jam)
    const startOfYear = getWIBDate(targetYear, 0, 1);
    // Akhir: 31 Des 23:59 (Mundur 7 jam)
    const endOfYear = getWIBDate(targetYear, 11, 31, 23, 59, 59, 999);

    const whereCondition: any = {
      isArchived: false,
      createdAt: { gte: startOfYear, lte: endOfYear },
    };

    if (userRole === 'SALES') {
        whereCondition.assignedUsers = { some: { id: !isNaN(Number(userId)) ? Number(userId) : userId } };
    }

    const leads = await prisma.lead.findMany({
      where: whereCondition,
      select: { createdAt: true },
    });

    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const chartData = months.map(month => ({ name: month, total: 0 }));

    leads.forEach(lead => {
      // 🔥 FIX LOGIC: Tambah 7 Jam dulu sebelum cek bulan
      // Agar "31 Jan 18:00 UTC" terbaca "1 Feb 01:00 WIB"
      const dateUTC = new Date(lead.createdAt);
      const dateWIB = new Date(dateUTC.getTime() + (7 * 60 * 60 * 1000)); 
      
      const monthIndex = dateWIB.getMonth();
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
    // @ts-ignore
    const user = req.user;
    // @ts-ignore
    const userId = user?.userId || user?.id || user?.sub;
    // @ts-ignore
    const userRole = user?.role;

    const { year } = req.query;
    const targetYear = year ? Number(year) : new Date().getFullYear();
    const months = Array.from({ length: 12 }, (_, i) => i);

    const userFilter: any = {};
    if (userRole === 'SALES') {
      userFilter.assignedUsers = { some: { id: !isNaN(Number(userId)) ? Number(userId) : userId } };
    }

    const chartData = await Promise.all(
      months.map(async (monthIndex) => {
        
        // 🔥 FIX: Pakai Helper WIB untuk range per bulan
        const startDate = getWIBDate(targetYear, monthIndex, 1);
        const endDate = getWIBDate(targetYear, monthIndex + 1, 0, 23, 59, 59, 999);

        // Nama Bulan (Untuk label chart)
        // Kita pakai object Date murni untuk ambil nama bulan biar gak geser
        const labelDate = new Date(targetYear, monthIndex, 1); 
        const monthName = labelDate.toLocaleString('default', { month: 'short' }); 

        // ESTIMATION (CreatedAt)
        const estimation = await prisma.lead.aggregate({
          _sum: { value: true },
          where: {
            ...userFilter,
            isArchived: false,
            createdAt: { gte: startDate, lte: endDate }
          }
        });

        // REALISATION (WonAt)
        const realisation = await prisma.lead.aggregate({
          _sum: { value: true },
          where: {
            ...userFilter,
            status: 'WON',
            isArchived: false,
            wonAt: { gte: startDate, lte: endDate }
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

    const { month, year, includeDetails } = req.query; // Tambah includeDetails

    const now = new Date();
    // Default ke waktu saat ini jika param tidak ada
    const targetYear = year ? Number(year) : now.getFullYear();
    const targetMonth = month ? Number(month) : now.getMonth(); 

    // --- LOGIKA QUARTER ---
    // Q1: Jan-Mar, Q2: Apr-Jun, dst.
    const quarterStartMonth = Math.floor(targetMonth / 3) * 3;
    const startDate = new Date(targetYear, quarterStartMonth, 1);
    
    // Akhir dari kuartal (3 bulan ke depan, tanggal 0 = hari terakhir bulan sebelumnya)
    const endDate = new Date(targetYear, quarterStartMonth + 3, 0, 23, 59, 59, 999);
    
    const quarterNumber = (quarterStartMonth / 3) + 1;

    // --- FILTER DATABASE ---
    const whereClause: any = {
      status: 'WON', // Hanya hitung yang sudah deal
      wonAt: {       // Filter berdasarkan tanggal deal (wonAt)
        gte: startDate,
        lte: endDate,
      },
      // isArchived: false, // Uncomment jika ingin menyembunyikan arsip
    };

    // Filter Khusus Role SALES: Hanya melihat data miliknya sendiri
    if (userRole === 'SALES') {
      whereClause.assignedUsers = {
        some: {
          // PERBAIKAN: Jangan paksa convert ke Number jika ID Anda UUID (String)
          // Jika DB Anda pakai Integer ID, ganti jadi: Number(userId)
          id: userId 
        }
      };
    }

    // 1. AGGREGATE SUMMARY (Total Revenue, Total Deals)
    const result = await prisma.lead.aggregate({
      _sum: { value: true },
      _count: { id: true },
      where: whereClause,
    });

    const totalRevenue = Number(result._sum.value) || 0;
    const totalDeals = Number(result._count.id) || 0;
    const averageSize = totalDeals > 0 ? Math.round(totalRevenue / totalDeals) : 0;

    // 2. GET TOP LEADS (Hanya jika diminta via query param 'includeDetails')
    // Ini menghemat performa saat hanya me-load card kecil di dashboard
    let topLeads: any[] = [];
    
    if (includeDetails === 'true') {
      topLeads = await prisma.lead.findMany({
        where: whereClause,
        orderBy: {
          value: 'desc', // Urutkan dari nilai terbesar
        },
        take: 100, // Ambil top 5 saja
        select: {
          id: true,
          title: true,
          company: true,
          value: true,
          wonAt: true, // Penting untuk ditampilkan di frontend
        },
      });
    }

    // 3. KIRIM RESPONSE
    res.json({
      quarter: quarterNumber,
      year: targetYear,
      // Label rentang tanggal untuk UI (misal: "Jan - Mar")
      rangeLabel: `${startDate.toLocaleString('default', { month: 'short' })} - ${endDate.toLocaleString('default', { month: 'short' })}`,
      data: {
        revenue: totalRevenue,
        deals: totalDeals,
        average: averageSize
      },
      // Array ini akan kosong jika includeDetails=false, atau berisi data jika true
      topLeads: topLeads 
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
            title: true,
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