import prisma from '../config/database'; 

export const sendNotification = async (
  userId: string,
  settingKey: 
    | "notifyLeadAssign" 
    | "notifyLeadUpdate" 
    | "notifyInvoice" 
    | "notifyActivity" 
    | "notifyNewLead" 
    | "notifyDealStatus",
  data: {
    title: string;
    message: string;
    type?: "INFO" | "SUCCESS" | "WARNING" | "ERROR";
    link?: string;
  }
) => {
  try {
    // 1. Cek User dan Setting-nya
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { [settingKey]: true } 
    });

    if (!user) return;

    // 2. Cek apakah user mengizinkan (true/false)
    const isAllowed = user[settingKey as keyof typeof user];

    if (!isAllowed) return; 

    // 3. Buat Notifikasi
    await prisma.notification.create({
      data: {
        userId,
        title: data.title,
        message: data.message,
        type: data.type || "INFO",
        link: data.link,
      },
    });

  } catch (error) {
    console.error("Gagal mengirim notifikasi:", error);
  }
};