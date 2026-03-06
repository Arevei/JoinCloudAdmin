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
    const isCustom = data.tier === "custom" && data.customQuota != null;
    const bodyText = isCustom
      ? `Your custom plan: ${data.customQuota} users/storage, ${data.deviceLimit} pairing devices.`
      : `Plan: ${data.tier}, ${data.deviceLimit} devices.`;

    const planLabel = data.tier === "pro" ? "Pro" : data.tier === "teams" ? "Teams" : data.tier === "custom" ? "Custom" : data.tier;

    const html = `
      <div style="font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; background:#0b1120; padding:24px; color:#e5e7eb;">
        <div style="max-width:520px;margin:0 auto;background:#020617;border:1px solid #1f2937;border-radius:12px;padding:24px;">
          <h1 style="font-size:22px;margin:0 0 8px;color:#f9fafb;">Your JoinCloud ${planLabel} plan is active</h1>
          <p style="margin:0 0 16px;color:#9ca3af;font-size:14px;">Thank you for choosing JoinCloud. Your subscription has been activated.</p>
          <div style="background:#020617;border-radius:10px;padding:14px 16px;border:1px solid #1f2937;margin-bottom:16px;">
            <div style="font-size:13px;color:#9ca3af;margin-bottom:4px;">Plan details</div>
            <div style="font-size:14px;color:#e5e7eb;">Plan: <strong>${planLabel}</strong></div>
            <div style="font-size:14px;color:#e5e7eb;">Devices: <strong>${data.deviceLimit}</strong></div>
            ${isCustom && typeof data.customQuota === "number" ? `<div style="font-size:14px;color:#e5e7eb;">Custom quota: <strong>${data.customQuota}</strong></div>` : ""}
            <div style="font-size:14px;color:#e5e7eb;">Expires on: <strong>${expiresDate}</strong></div>
          </div>
          <p style="margin:0 0 12px;font-size:13px;color:#9ca3af;">
            Open the JoinCloud desktop app and use the <strong>Dashboard</strong> and <strong>Billing</strong> sections to manage your devices and teams.
          </p>
          <p style="margin:0;font-size:12px;color:#6b7280;">If you have any questions, reply to this email or contact support.</p>
        </div>
        <p style="max-width:520px;margin:12px auto 0;font-size:11px;color:#4b5563;text-align:center;">
          © ${new Date().getFullYear()} JoinCloud. All rights reserved.
        </p>
      </div>
    `;

    await transporter.sendMail({
      from,
      to: data.to,
      subject: `JoinCloud license granted: ${data.tier}`,
      text: `Your JoinCloud license has been granted.\n\nLicense ID: ${data.licenseId}\n${bodyText}\nExpires: ${expiresDate}`,
      html,
    });
  } catch (err) {
    console.error("Failed to send license grant email:", err);
  }
}

interface SubscriptionRequestEmailData {
  planId: string;
  email: string;
  phone?: string | null;
  accountId?: string | null;
  deviceId?: string | null;
  customUsers?: number | null;
  customDevices?: number | null;
}

export async function sendSubscriptionRequestEmails(data: SubscriptionRequestEmailData): Promise<void> {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.MAIL_FROM || process.env.SMTP_USER || "noreply@joincloud.local";
  const adminEmail = process.env.SUBSCRIPTION_ADMIN_EMAIL || "rishabh@arevei.com";

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

    const adminSummaryLines = [
      `Plan: ${data.planId}`,
      `Email: ${data.email}`,
      data.phone ? `Phone: ${data.phone}` : null,
      data.accountId ? `Account ID: ${data.accountId}` : null,
      data.deviceId ? `Device ID: ${data.deviceId}` : null,
      data.customUsers != null ? `Custom users: ${data.customUsers}` : null,
      data.customDevices != null ? `Custom devices: ${data.customDevices}` : null,
    ].filter(Boolean);

    const adminBody =
      `A new manual subscription request has been submitted.\n\n` +
      adminSummaryLines.join("\n") +
      `\n\nYou can review and approve this request from the admin panel.`;

    await transporter.sendMail({
      from,
      to: adminEmail,
      subject: `New subscription request: ${data.planId}`,
      text: adminBody,
    });

    const userSummaryLines = [
      `Plan: ${data.planId}`,
      data.customUsers != null ? `Requested users: ${data.customUsers}` : null,
      data.customDevices != null ? `Requested devices: ${data.customDevices}` : null,
    ].filter(Boolean);

    const userTextBody =
      `Thank you for your interest in JoinCloud.\n\n` +
      `We have received your request for the ${data.planId} plan and will contact you shortly to complete payment and activation.\n\n` +
      (userSummaryLines.length ? `Summary:\n${userSummaryLines.join("\n")}\n\n` : "") +
      `If you did not initiate this request, please ignore this email.`;

    const userHtmlBody = `
      <div style="font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; background:#0b1120; padding:24px; color:#e5e7eb;">
        <div style="max-width:520px;margin:0 auto;background:#020617;border:1px solid #1f2937;border-radius:12px;padding:24px;">
          <h1 style="font-size:22px;margin:0 0 8px;color:#f9fafb;">We received your JoinCloud plan request</h1>
          <p style="margin:0 0 16px;color:#9ca3af;font-size:14px;">
            Thank you for your interest in the <strong>${data.planId}</strong> plan. Our team will contact you shortly to complete payment and activate your subscription.
          </p>
          ${
            userSummaryLines.length
              ? `<div style="background:#020617;border-radius:10px;padding:14px 16px;border:1px solid #1f2937;margin-bottom:16px;">
                  <div style="font-size:13px;color:#9ca3af;margin-bottom:4px;">Request summary</div>
                  ${userSummaryLines.map((line) => `<div style="font-size:14px;color:#e5e7eb;">${line}</div>`).join("")}
                </div>`
              : ""
          }
          <p style="margin:0 0 12px;font-size:13px;color:#9ca3af;">
            You can keep using the JoinCloud desktop app while we process your request. Once approved, your plan will be reflected automatically.
          </p>
          <p style="margin:0;font-size:12px;color:#6b7280;">If you did not initiate this request, you can ignore this email.</p>
        </div>
        <p style="max-width:520px;margin:12px auto 0;font-size:11px;color:#4b5563;text-align:center;">
          © ${new Date().getFullYear()} JoinCloud. All rights reserved.
        </p>
      </div>
    `;

    await transporter.sendMail({
      from,
      to: data.email,
      subject: `We received your JoinCloud plan request (${data.planId})`,
      text: userTextBody,
      html: userHtmlBody,
    });
  } catch (err) {
    console.error("Failed to send subscription request email:", err);
  }
}
