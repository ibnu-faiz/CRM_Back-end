-- AlterTable
ALTER TABLE `users` ADD COLUMN `googleId` VARCHAR(191) NULL,
    MODIFY `password` VARCHAR(191) NULL;
