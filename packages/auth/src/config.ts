/**
 * Token lifetimes, as constants rather than configuration.
 *
 * They are a security property, not a tuning knob: a deployment that quietly set a 30-day
 * access token would have removed the guarantee the short TTL exists to provide.
 *
 * 15 minutes is short enough that a leaked access token has a small blast radius and
 * long enough that rotation is not happening on every page view. Refresh tokens live
 * 30 days but are single-use: the security property comes from rotation and reuse
 * detection, not from the lifetime.
 */
export const DEFAULT_ACCESS_TOKEN_TTL_S = 15 * 60;
export const DEFAULT_REFRESH_TOKEN_TTL_S = 30 * 24 * 60 * 60;

/** Refresh a little before expiry so a request never races the boundary. */
export const ACCESS_TOKEN_REFRESH_SKEW_S = 60;
