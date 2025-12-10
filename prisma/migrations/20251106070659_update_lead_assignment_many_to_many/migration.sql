/*
  Warnings:

  - You are about to drop the column `assignedToId` on the `leads` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE `leads` DROP FOREIGN KEY `leads_assignedToId_fkey`;

-- DropIndex
DROP INDEX `leads_assignedToId_fkey` ON `leads`;

-- AlterTable
ALTER TABLE `leads` DROP COLUMN `assignedToId`;

-- CreateTable
CREATE TABLE `_LeadsAssigned` (
    `A` VARCHAR(191) NOT NULL,
    `B` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `_LeadsAssigned_AB_unique`(`A`, `B`),
    INDEX `_LeadsAssigned_B_index`(`B`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `_LeadsAssigned` ADD CONSTRAINT `_LeadsAssigned_A_fkey` FOREIGN KEY (`A`) REFERENCES `leads`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_LeadsAssigned` ADD CONSTRAINT `_LeadsAssigned_B_fkey` FOREIGN KEY (`B`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
