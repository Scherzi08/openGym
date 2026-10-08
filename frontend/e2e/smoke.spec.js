import { test, expect } from '@playwright/test'

test('app shell loads', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle(/openGym/)
  await expect(page.locator('#root')).not.toBeEmpty()
})
