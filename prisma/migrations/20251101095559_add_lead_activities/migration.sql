-- CreateTable
CREATE TABLE `lead_activities` (
    `id` VARCHAR(191) NOT NULL,
    `type` ENUM('NOTE', 'CALL', 'MEETING', 'EMAIL', 'TASK', 'INVOICE', 'STATUS_CHANGE') NOT NULL,
    `content` TEXT NOT NULL,
    `meta` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `leadId` VARCHAR(191) NOT NULL,
    `createdById` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `lead_activities` ADD CONSTRAINT `lead_activities_leadId_fkey` FOREIGN KEY (`leadId`) REFERENCES `leads`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lead_activities` ADD CONSTRAINT `lead_activities_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
