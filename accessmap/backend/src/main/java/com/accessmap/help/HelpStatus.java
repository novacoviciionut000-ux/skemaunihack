package com.accessmap.help;

/**
 * OPEN -> ACCEPTED -> AWAITING_CONFIRMATION -> COMPLETED
 *            ^                 |
 *            +------ "nu" -----+        (client says it was not done)
 * OPEN / ACCEPTED -> CANCELLED (client), OPEN / ACCEPTED / AWAITING -> EXPIRED (timeout)
 */
public enum HelpStatus {
    OPEN,
    ACCEPTED,
    AWAITING_CONFIRMATION,
    COMPLETED,
    CANCELLED,
    EXPIRED;

    public boolean isActive() {
        return this == OPEN || this == ACCEPTED || this == AWAITING_CONFIRMATION;
    }
}
