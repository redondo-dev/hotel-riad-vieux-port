-- Size of the photos of the categories (module « Photos »), so that the public site reserves
-- their place before they load (no jump of the page). The width and height are those of the
-- largest stored version, after the rotation given by the camera. Nullable: the table may
-- already hold rows without them; every new photo has them.
ALTER TABLE category_photos
  ADD COLUMN width integer CHECK (width > 0),
  ADD COLUMN height integer CHECK (height > 0);
