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
        let condition: any = {};
        
        // Filter Tanggal (Kalau ada)
        if (sDate && eDate) {
            condition.createdAt = { gte: sDate, lte: eDate };
        }

        // Filter Role Sales (Hanya liat punya sendiri)
        if (userRole === 'SALES') {
            condition.assignedToId = userId;
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
      createdAt: {
        gte: startOfYear,
        lte: endOfYear,
      },
    };

    if (userRole === 'SALES') {
      whereCondition.assignedToId = userId;
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
      createdAt: { gte: startOfYear, lte: endOfYear },
    };

    if (userRole === 'SALES') {
      whereCondition.assignedToId = userId;
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