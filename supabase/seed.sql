-- ==============================================================================
-- CHURCH MANAGEMENT SYSTEM - OPTIONAL DEVELOPMENT SEED DATA
-- WARNING: FOR DEVELOPMENT & TESTING PURPOSES ONLY.
-- DO NOT RUN THIS IN PRODUCTION.
-- ==============================================================================

-- 1. Insert Fictional Churches
INSERT INTO public.churches (id, code, slug, name, address, phone, email, is_active)
VALUES 
  ('a1000000-0000-0000-0000-000000000001', 'GBC-CHN', 'grace-bethel', 'Grace Bethel Church, Chennai', '45 Anna Salai, Chennai, Tamil Nadu 600002', '+91 98400 11223', 'office@gracebethel-chennai.org', true),
  ('a2000000-0000-0000-0000-000000000002', 'SMC-BLR', 'st-marks-blr', 'St. Mark Community Church, Bengaluru', '12 Richmond Road, Bengaluru, Karnataka 560025', '+91 98800 44556', 'info@stmarks-blr.org', true)
ON CONFLICT (id) DO NOTHING;

-- 2. Insert Standard Donation Categories for Church 1
INSERT INTO public.donation_categories (id, church_id, name, is_active)
VALUES
  ('c1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'Tithe', true),
  ('c1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', 'Offering', true),
  ('c1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', 'Building Fund', true),
  ('c1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000001', 'Missions', true),
  ('c1000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-000000000001', 'Special Collection', true)
ON CONFLICT (id) DO NOTHING;

-- Categories for Church 2
INSERT INTO public.donation_categories (id, church_id, name, is_active)
VALUES
  ('c2000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000002', 'Tithe', true),
  ('c2000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000002', 'Sunday Offering', true),
  ('c2000000-0000-0000-0000-000000000003', 'a2000000-0000-0000-0000-000000000002', 'Youth Outreach', true)
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
INSERT INTO public.members (id, church_id, member_number, full_name, contact_phone, village_name, gender, joining_date, membership_status)
VALUES
  ('m1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'M-0001', 'Ebenezer Raj', '+91 98401 22334', 'Tambaram', 'male', '2024-01-15', 'active'),
  ('m1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', 'M-0002', 'Grace Hannah', '+91 98402 33445', 'Guindy', 'female', '2024-02-01', 'active'),
  ('m1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', 'M-0003', 'Samuel Jayakumar', '+91 98403 44556', 'Velachery', 'male', '2024-05-10', 'active'),
  ('m1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000001', 'M-0004', 'Deborah Selvi', '+91 98404 55667', 'Tambaram', 'female', '2025-01-20', 'inactive'),
  ('m1000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-000000000001', 'M-0005', 'Paul Vijay', '+91 98405 66778', 'Adyar', 'male', '2025-04-12', 'active')
ON CONFLICT (id) DO NOTHING;

-- 5. Insert Church Settings (SMS Plan B gateway status placeholder)
INSERT INTO public.church_settings (church_id, setting_key, setting_value)
VALUES
  ('a1000000-0000-0000-0000-000000000001', 'sms_provider', '{"mode": "android_sms_gateway", "provider_enabled": false}'::jsonb),
  ('a2000000-0000-0000-0000-000000000002', 'sms_provider', '{"mode": "android_sms_gateway", "provider_enabled": false}'::jsonb)
ON CONFLICT (church_id, setting_key) DO NOTHING;

-- 6. Insert Per-Church Sample Expense Categories
INSERT INTO public.expense_categories (id, church_id, name, is_active)
VALUES
  ('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'Utilities & Electricity', true),
  ('e1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', 'Staff Salaries & Stipends', true),
  ('e1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', 'Building Maintenance', true),
  ('e1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000001', 'Missions & Outreach', true),
  ('e2000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000002', 'Electricity & Water', true),
  ('e2000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000002', 'Ministry Supplies', true),
  ('e2000000-0000-0000-0000-000000000003', 'a2000000-0000-0000-0000-000000000002', 'Charity & Relief', true)
ON CONFLICT (id) DO NOTHING;
