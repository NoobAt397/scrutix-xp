-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- Table: contracts
-- Stores courier/logistics provider rate card information
-- ============================================================
CREATE TABLE IF NOT EXISTS contracts (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_name       TEXT        NOT NULL,
  zone_a_rate         FLOAT,
  zone_b_rate         FLOAT,
  zone_c_rate         FLOAT,
  cod_fee_percentage  FLOAT,
  rto_flat_fee        FLOAT,
  created_at          TIMESTAMP   DEFAULT NOW()
);

-- ============================================================
-- Table: invoices
-- Stores uploaded invoice metadata
-- ============================================================
CREATE TABLE IF NOT EXISTS invoices (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name      TEXT        NOT NULL,
  provider_name  TEXT        NOT NULL,
  total_billed   FLOAT,
  status         TEXT        DEFAULT 'pending',
  created_at     TIMESTAMP   DEFAULT NOW()
);

-- ============================================================
-- Table: discrepancies
-- Stores per-AWB billing discrepancies found during audit
-- ============================================================
CREATE TABLE IF NOT EXISTS discrepancies (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id      UUID        REFERENCES invoices(id) ON DELETE CASCADE,
  awb_number      TEXT        NOT NULL,
  issue_type      TEXT,
  billed_amount   FLOAT,
  correct_amount  FLOAT,
  difference      FLOAT,
  created_at      TIMESTAMP   DEFAULT NOW()
);
