-- Reverts 0001. Extensions are left installed: other databases objects may rely on them,
-- and keeping them is harmless.
DROP FUNCTION IF EXISTS is_valid_stay_range(daterange);
DROP FUNCTION IF EXISTS forbid_truncate();
DROP FUNCTION IF EXISTS set_updated_at();
