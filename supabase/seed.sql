-- ==============================================================================
-- CHURCH MANAGEMENT SYSTEM - OPTIONAL DEVELOPMENT SEED DATA
-- WARNING: FOR DEVELOPMENT & TESTING PURPOSES ONLY.
-- DO NOT RUN THIS IN PRODUCTION.
-- ==============================================================================

-- 1. Insert Fictional Churches
INSERT INTO public.churches (id, code, name, address, phone, email, receipt_prefix, is_active)
VALUES 
  ('a1000000-0000-0000-0000-000000000001', 'GBC-CHN', 'Grace Bethel Church, Chennai', '45 Anna Salai, Chennai, Tamil Nadu 600002', '+91 98400 11223', 'office@gracebethel-chennai.org', 'GBC/2026-27/', true),
  ('a2000000-0000-0000-0000-000000000002', 'SMC-BLR', 'St. Mark Community Church, Bengaluru', '12 Richmond Road, Bengaluru, Karnataka 560025', '+91 98800 44556', 'info@stmarks-blr.org', 'SMC/2026-27/', true)
ON CONFLICT (id) DO NOTHING;

-- 2. Insert Standard Donation Categories for Church 1
INSERT INTO public.donation_categories (id, church_id, name, code, is_active)
VALUES
  ('c1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'Tithe', 'TITHE', true),
  ('c1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', 'Offering', 'OFFERING', true),
  ('c1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', 'Building Fund', 'BLDG_FUND', true),
  ('c1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000001', 'Missions', 'MISSIONS', true),
  ('c1000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-000000000005', 'Special Collection', 'SPECIAL', true)
ON CONFLICT (id) DO NOTHING;

-- Categories for Church 2
INSERT INTO public.donation_categories (id, church_id, name, code, is_active)
VALUES
  ('c2000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000002', 'Tithe', 'TITHE', true),
  ('c2000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000002', 'Sunday Offering', 'OFFERING', true),
  ('c2000000-0000-0000-0000-000000000003', 'a2000000-0000-0000-0000-000000000002', 'Youth Outreach', 'YOUTH', true)
ON CONFLICT (id) DO NOTHING;

-- 3. Insert Receiving Accounts for Church 1
INSERT INTO public.receiving_accounts (id, church_id, account_name, account_type, bank_name, account_number_mask, is_active)
VALUES
  ('b1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'Church General Cash', 'cash', NULL, NULL, true),
  ('b1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', 'SBI Main Church Account', 'bank', 'State Bank of India', '•••• 8912', true),
  ('b1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', 'HDFC Building Fund Account', 'bank', 'HDFC Bank', '•••• 4521', true)
ON CONFLICT (id) DO NOTHING;

-- Receiving Accounts for Church 2
INSERT INTO public.receiving_accounts (id, church_id, account_name, account_type, bank_name, account_number_mask, is_active)
VALUES
  ('b2000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000002', 'Church Cash Box', 'cash', NULL, NULL, true),
  ('b2000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000002', 'Canara Bank Operational', 'bank', 'Canara Bank', '•••• 3319', true)
ON CONFLICT (id) DO NOTHING;

-- 4. Insert Fictional Members for Church 1
INSERT INTO public.members (id, church_id, member_number, full_name, contact_phone, contact_email, village_name, gender, joining_date, membership_status)
VALUES
  ('m1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'M-0001', 'Ebenezer Raj', '+91 98401 22334', 'ebenezer.raj@example.com', 'Tambaram', 'male', '2024-01-15', 'active'),
  ('m1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', 'M-0002', 'Grace Hannah', '+91 98402 33445', 'grace.hannah@example.com', 'Guindy', 'female', '2024-02-01', 'active'),
  ('m1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', 'M-0003', 'Samuel Jayakumar', '+91 98403 44556', 'samuel.j@example.com', 'Velachery', 'male', '2024-05-10', 'active'),
  ('m1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000001', 'M-0004', 'Deborah Selvi', '+91 98404 55667', 'deborah.s@example.com', 'Tambaram', 'female', '2025-01-20', 'inactive'),
  ('m1000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-000000000001', 'M-0005', 'Paul Vijay', '+91 98405 66778', 'paul.vijay@example.com', 'Adyar', 'male', '2025-04-12', 'active')
ON CONFLICT (id) DO NOTHING;

-- 5. Insert Church Settings (e.g. Leaderboard privacy & SMS config placeholders)
INSERT INTO public.church_settings (church_id, setting_key, setting_value)
VALUES
  ('a1000000-0000-0000-0000-000000000001', 'leaderboard', '{"mask_names_by_default": true, "show_top_10": true}'::jsonb),
  ('a1000000-0000-0000-0000-000000000001', 'sms_provider', '{"mode": "send_from_phone", "provider_enabled": false}'::jsonb),
  ('a2000000-0000-0000-0000-000000000002', 'leaderboard', '{"mask_names_by_default": true, "show_top_10": true}'::jsonb),
  ('a2000000-0000-0000-0000-000000000002', 'sms_provider', '{"mode": "send_from_phone", "provider_enabled": false}'::jsonb)
ON CONFLICT (church_id, setting_key) DO NOTHING;
