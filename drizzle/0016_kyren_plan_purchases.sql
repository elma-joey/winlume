CREATE TABLE "reizo_kyren_events" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"payload_hash" varchar(64) NOT NULL,
	"type" varchar(80) NOT NULL,
	"purchase_id" varchar(64) NOT NULL,
	"status" varchar(32) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reizo_plan_purchases" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"plan_id" varchar(20) NOT NULL,
	"product_id" varchar(128) NOT NULL,
	"native_plan_id" integer NOT NULL,
	"amount" varchar(32) NOT NULL,
	"allowance" integer NOT NULL,
	"status" varchar(32) DEFAULT 'creating' NOT NULL,
	"native_reference" varchar(128),
	"checkout_id" varchar(128),
	"checkout_url" text,
	"checkout_expires_at" timestamp with time zone,
	"provider_order_id" varchar(128),
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reizo_plan_purchases" ADD CONSTRAINT "reizo_plan_purchases_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reizo_plan_purchases" ADD CONSTRAINT "reizo_plan_purchases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reizo_plan_native_reference" ON "reizo_plan_purchases" USING btree ("native_reference");--> statement-breakpoint
CREATE UNIQUE INDEX "reizo_plan_checkout" ON "reizo_plan_purchases" USING btree ("checkout_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reizo_plan_provider_order" ON "reizo_plan_purchases" USING btree ("provider_order_id");--> statement-breakpoint
CREATE INDEX "reizo_plan_org" ON "reizo_plan_purchases" USING btree ("organization_id");