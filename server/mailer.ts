/**
 * Optional email sender for license grant notifications.
 * Set SMTP env vars to enable; otherwise no-op.
 */

export interface LicenseGrantEmailData {
  to: string;
  tier: string;
  licenseId: string;
  deviceLimit: number;
  expiresAt: number;
  customQuota?: number | null;
}

export async function sendLicenseGrantEmail(data: LicenseGrantEmailData): Promise<void> {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.MAIL_FROM || process.env.SMTP_USER || "noreply@joincloud.local";

  if (!host || !user || !pass) {
    return;
  }

  try {
    const nodemailer = await import("nodemailer");
    const transporter = nodemailer.default.createTransport({
      host,
      port: port ? parseInt(port, 10) : 587,
      secure: false,
      auth: { user, pass },
    });
    const expiresDate = new Date(data.expiresAt * 1000).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    const body =
      data.tier === "custom" && data.customQuota != null
        ? `Your custom plan: ${data.customQuota} users/storage, ${data.deviceLimit} pairing devices.`
        : `Plan: ${data.tier}, ${data.deviceLimit} devices.`;
    await transporter.sendMail({
      from,
      to: data.to,
      subject: `JoinCloud license granted: ${data.tier}`,
      text: `Your JoinCloud license has been granted.\n\nLicense ID: ${data.licenseId}\n${body}\nExpires: ${expiresDate}`,
    });
  } catch (err) {
    console.error("Failed to send license grant email:", err);
  }
}
