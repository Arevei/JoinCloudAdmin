CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"trial_used" integer DEFAULT 0 NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"stripe_customer_id" text,
	"subscription_id" text,
	"subscription_status" text,
	"renewal_at" text,
	"grace_ends_at" text,
	"razorpay_customer_id" text,
	"razorpay_subscription_id" text,
	"username" text,
	"referral_code" text,
	"referred_by" text,
	"referral_count" integer DEFAULT 0,
	"referral_days_earned" integer DEFAULT 0,
	"device_change_count" integer DEFAULT 0,
	"last_device_change_at" text,
	"admin_role" text,
	CONSTRAINT "accounts_email_unique" UNIQUE("email"),
	CONSTRAINT "accounts_referral_code_unique" UNIQUE("referral_code")
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_metrics" (
	"user_id" text NOT NULL,
	"date" text NOT NULL,
	"uptime_seconds" integer DEFAULT 0 NOT NULL,
	"files_uploaded" integer DEFAULT 0 NOT NULL,
	"files_downloaded" integer DEFAULT 0 NOT NULL,
	"bytes_uploaded" integer DEFAULT 0 NOT NULL,
	"bytes_downloaded" integer DEFAULT 0 NOT NULL,
	"shares_created" integer DEFAULT 0 NOT NULL,
	"public_shares" integer DEFAULT 0 NOT NULL,
	"lan_shares" integer DEFAULT 0 NOT NULL,
	"network_visibility_enabled" boolean DEFAULT true,
	"network_peers_detected" integer DEFAULT 0,
	"display_name_customized" boolean DEFAULT false,
	CONSTRAINT "daily_metrics_user_id_date_pk" PRIMARY KEY("user_id","date")
);
--> statement-breakpoint
CREATE TABLE "device_logout_requests" (
	"host_uuid" text PRIMARY KEY NOT NULL,
	"requested_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"device_uuid" text NOT NULL,
	"level" text NOT NULL,
	"message" text NOT NULL,
	"context" text,
	"timestamp" text NOT NULL,
	"expires_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_recovery_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"old_device_id" text NOT NULL,
	"new_device_id" text NOT NULL,
	"reason" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"admin_notes" text,
	"created_at" text NOT NULL,
	"resolved_at" text,
	"resolved_by" text
);
--> statement-breakpoint
CREATE TABLE "device_trial_used" (
	"host_uuid" text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_trials" (
	"device_id" text PRIMARY KEY NOT NULL,
	"trial_started_at" text NOT NULL,
	"trial_ends_at" text NOT NULL,
	"trial_extended_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_usage_monthly" (
	"device_id" text NOT NULL,
	"ym" text NOT NULL,
	"shares_created" integer DEFAULT 0 NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "device_usage_monthly_device_id_ym_pk" PRIMARY KEY("device_id","ym")
);
--> statement-breakpoint
CREATE TABLE "hosts" (
	"id" serial PRIMARY KEY NOT NULL,
	"host_uuid" text NOT NULL,
	"installation_id" text NOT NULL,
	"first_seen_at" text NOT NULL,
	"last_seen_at" text NOT NULL,
	"first_installed_at" text NOT NULL,
	"version" text NOT NULL,
	"platform" text NOT NULL,
	"arch" text NOT NULL,
	"trial_start_at" text,
	"trial_ends_at" text,
	"trial_extended_at" text,
	"registration_status" text DEFAULT 'registered' NOT NULL,
	"suspended" integer DEFAULT 0,
	"suspension_reason" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "hosts_host_uuid_unique" UNIQUE("host_uuid")
);
--> statement-breakpoint
CREATE TABLE "license_hosts" (
	"id" serial PRIMARY KEY NOT NULL,
	"license_id" text NOT NULL,
	"host_uuid" text NOT NULL,
	"activated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "license_members" (
	"license_id" text NOT NULL,
	"account_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "license_members_license_id_account_id_pk" PRIMARY KEY("license_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "licenses" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"tier" text NOT NULL,
	"device_limit" integer NOT NULL,
	"issued_at" integer NOT NULL,
	"expires_at" integer NOT NULL,
	"state" text NOT NULL,
	"signature" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"plan_interval" text,
	"grace_ends_at" integer,
	"renewal_at" integer,
	"custom_quota" integer,
	"user_limit" integer,
	"team_limit" integer,
	"share_limit_monthly" integer,
	"devices_per_user" integer,
	"overrides_json" text,
	"payment_method" text,
	"amount_paid" integer,
	"currency" text DEFAULT 'INR',
	"payment_provider" text,
	"invoice_id" text,
	"discount_percent" integer DEFAULT 0,
	"notes" text,
	"is_device_only" integer DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" text PRIMARY KEY NOT NULL,
	"subscription_id" text,
	"account_id" text NOT NULL,
	"device_id" text,
	"provider" text NOT NULL,
	"provider_payment_id" text,
	"amount" integer NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"invoice_url" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "public_share_links" (
	"id" text PRIMARY KEY NOT NULL,
	"short_id" text NOT NULL,
	"tunnel_url" text NOT NULL,
	"share_id" text NOT NULL,
	"host_id" text NOT NULL,
	"expires_at" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "public_share_links_short_id_unique" UNIQUE("short_id")
);
--> statement-breakpoint
CREATE TABLE "referrals" (
	"id" text PRIMARY KEY NOT NULL,
	"referrer_account_id" text NOT NULL,
	"referred_account_id" text NOT NULL,
	"referral_code" text NOT NULL,
	"days_granted" integer DEFAULT 10 NOT NULL,
	"status" text DEFAULT 'completed' NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"plan_id" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"account_id" text,
	"device_id" text,
	"custom_users" integer,
	"custom_devices" integer,
	"requested_days" integer,
	"requested_share_limit" integer,
	"requested_device_limit" integer,
	"notes" text,
	"license_id" text,
	"approved_by" text,
	"approved_at" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"license_id" text,
	"provider" text NOT NULL,
	"provider_subscription_id" text,
	"plan" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"amount" integer NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"interval" text DEFAULT 'month' NOT NULL,
	"current_period_start" integer,
	"current_period_end" integer,
	"payment_due_date" integer,
	"grace_ends_at" integer,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"thread_id" integer NOT NULL,
	"sender" text NOT NULL,
	"text" text NOT NULL,
	"timestamp" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_threads" (
	"id" serial PRIMARY KEY NOT NULL,
	"device_uuid" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "support_threads_device_uuid_unique" UNIQUE("device_uuid")
);
--> statement-breakpoint
CREATE TABLE "team_invitations" (
	"id" serial PRIMARY KEY NOT NULL,
	"license_id" text NOT NULL,
	"email" text NOT NULL,
	"invited_by" text NOT NULL,
	"invited_at" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tunnels" (
	"id" text PRIMARY KEY NOT NULL,
	"host_id" text NOT NULL,
	"tunnel_id" text NOT NULL,
	"tunnel_name" text NOT NULL,
	"subdomain" text NOT NULL,
	"public_url" text NOT NULL,
	"credentials_json" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "tunnels_host_id_unique" UNIQUE("host_id"),
	CONSTRAINT "tunnels_tunnel_id_unique" UNIQUE("tunnel_id"),
	CONSTRAINT "tunnels_subdomain_unique" UNIQUE("subdomain")
);
--> statement-breakpoint
CREATE TABLE "update_manifest_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"version" text NOT NULL,
	"release_date" text NOT NULL,
	"channel" text DEFAULT 'stable' NOT NULL,
	"changelog_json" text DEFAULT '[]' NOT NULL,
	"downloads_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "update_manifest_entries_version_unique" UNIQUE("version")
);
--> statement-breakpoint
CREATE TABLE "usage_aggregates" (
	"id" serial PRIMARY KEY NOT NULL,
	"host_uuid" text NOT NULL,
	"period_start" text NOT NULL,
	"period_end" text NOT NULL,
	"uptime_seconds" integer DEFAULT 0 NOT NULL,
	"storage_used_bytes" integer DEFAULT 0 NOT NULL,
	"bytes_uploaded" integer DEFAULT 0 NOT NULL,
	"bytes_downloaded" integer DEFAULT 0 NOT NULL,
	"total_shares" integer DEFAULT 0 NOT NULL,
	"total_devices" integer DEFAULT 0 NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"user_id" text PRIMARY KEY NOT NULL,
	"device_index" integer,
	"first_seen" text,
	"last_seen" text,
	"last_heartbeat" text,
	"app_version" text,
	"os" text
);
--> statement-breakpoint
ALTER TABLE "device_recovery_requests" ADD CONSTRAINT "device_recovery_requests_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "license_hosts" ADD CONSTRAINT "license_hosts_license_id_licenses_id_fk" FOREIGN KEY ("license_id") REFERENCES "public"."licenses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "license_members" ADD CONSTRAINT "license_members_license_id_licenses_id_fk" FOREIGN KEY ("license_id") REFERENCES "public"."licenses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "license_members" ADD CONSTRAINT "license_members_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "licenses" ADD CONSTRAINT "licenses_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrer_account_id_accounts_id_fk" FOREIGN KEY ("referrer_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referred_account_id_accounts_id_fk" FOREIGN KEY ("referred_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_requests" ADD CONSTRAINT "subscription_requests_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_requests" ADD CONSTRAINT "subscription_requests_license_id_licenses_id_fk" FOREIGN KEY ("license_id") REFERENCES "public"."licenses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_license_id_licenses_id_fk" FOREIGN KEY ("license_id") REFERENCES "public"."licenses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_thread_id_support_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."support_threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_invitations" ADD CONSTRAINT "team_invitations_license_id_licenses_id_fk" FOREIGN KEY ("license_id") REFERENCES "public"."licenses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_invitations" ADD CONSTRAINT "team_invitations_invited_by_accounts_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_accounts_referral_code" ON "accounts" USING btree ("referral_code");--> statement-breakpoint
CREATE INDEX "idx_device_logs_expires" ON "device_logs" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_recovery_account" ON "device_recovery_requests" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "idx_recovery_status" ON "device_recovery_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_hosts_host_uuid" ON "hosts" USING btree ("host_uuid");--> statement-breakpoint
CREATE INDEX "idx_hosts_last_seen" ON "hosts" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX "idx_license_hosts_license" ON "license_hosts" USING btree ("license_id");--> statement-breakpoint
CREATE INDEX "idx_license_hosts_host" ON "license_hosts" USING btree ("host_uuid");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_license_hosts" ON "license_hosts" USING btree ("license_id","host_uuid");--> statement-breakpoint
CREATE INDEX "idx_license_members_license" ON "license_members" USING btree ("license_id");--> statement-breakpoint
CREATE INDEX "idx_license_members_account" ON "license_members" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "idx_payments_account" ON "payments" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "idx_payments_subscription" ON "payments" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX "idx_payments_status" ON "payments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_public_share_links_share_id" ON "public_share_links" USING btree ("share_id");--> statement-breakpoint
CREATE INDEX "idx_referrals_referrer" ON "referrals" USING btree ("referrer_account_id");--> statement-breakpoint
CREATE INDEX "idx_referrals_referred" ON "referrals" USING btree ("referred_account_id");--> statement-breakpoint
CREATE INDEX "idx_subscription_requests_status" ON "subscription_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_subscription_requests_account" ON "subscription_requests" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "idx_subscriptions_account" ON "subscriptions" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "idx_subscriptions_license" ON "subscriptions" USING btree ("license_id");--> statement-breakpoint
CREATE INDEX "idx_subscriptions_status" ON "subscriptions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_team_invitations_email" ON "team_invitations" USING btree ("email");--> statement-breakpoint
CREATE INDEX "idx_team_invitations_license" ON "team_invitations" USING btree ("license_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_team_invitations" ON "team_invitations" USING btree ("license_id","email");--> statement-breakpoint
CREATE INDEX "idx_update_manifest_entries_release_date" ON "update_manifest_entries" USING btree ("release_date");--> statement-breakpoint
CREATE INDEX "idx_usage_aggregates_host" ON "usage_aggregates" USING btree ("host_uuid");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_usage_aggregates" ON "usage_aggregates" USING btree ("host_uuid","period_start");