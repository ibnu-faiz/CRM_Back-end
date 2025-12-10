/*
  Warnings:

  - You are about to drop the column `isActive` on the `users` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE `users` DROP COLUMN `isActive`,
    ADD COLUMN `bio` TEXT NULL,
    ADD COLUMN `department` VARCHAR(191) NULL,
    ADD COLUMN `joinedAt` DATETIME(3) NULL,
    ADD COLUMN `location` VARCHAR(191) NULL,
    ADD COLUMN `reportsToId` VARCHAR(191) NULL,
    ADD COLUMN `skills` JSON NULL,
    ADD COLUMN `status` ENUM('ACTIVE', 'INACTIVE', 'ONBOARDING', 'ON_LEAVE') NOT NULL DEFAULT 'ACTIVE';

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_reportsToId_fkey` FOREIGN KEY (`reportsToId`) REFERENCES `users`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;
