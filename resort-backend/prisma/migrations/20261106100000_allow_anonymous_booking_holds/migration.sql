ALTER TABLE "BookingHold"
  DROP CONSTRAINT "BookingHold_dates_and_owner_check";

ALTER TABLE "BookingHold"
  ADD CONSTRAINT "BookingHold_dates_and_owner_check"
  CHECK ("checkIn" < "checkOut");
