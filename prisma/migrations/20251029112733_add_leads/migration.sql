-- CreateTable
CREATE TABLE `leads` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `company` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `value` DOUBLE NOT NULL DEFAULT 0,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'IDR',
    `status` ENUM('LEAD_IN', 'CONTACT_MADE', 'NEED_IDENTIFIED', 'PROPOSAL_MADE', 'NEGOTIATION', 'CONTRACT_SEND', 'WON', 'LOST') NOT NULL DEFAULT 'LEAD_IN',
    `priority` ENUM('LOW', 'MEDIUM', 'HIGH') NOT NULL DEFAULT 'MEDIUM',
    `label` VARCHAR(191) NULL,
    `contacts` VARCHAR(191) NULL,
    `dueDate` DATETIME(3) NULL,
    `description` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `wonAt` DATETIME(3) NULL,
    `lostAt` DATETIME(3) NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `assignedToId` VARCHAR(191) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `leads` ADD CONSTRAINT `leads_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leads` ADD CONSTRAINT `leads_assignedToId_fkey` FOREIGN KEY (`assignedToId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
