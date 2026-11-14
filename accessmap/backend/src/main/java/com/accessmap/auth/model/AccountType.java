package com.accessmap.auth.model;

/** CLIENT asks for help (distress button), VOLUNTEER answers and earns Deed points. */
public enum AccountType {
    CLIENT,
    VOLUNTEER;

    /** Lenient parse for request bodies; anything unknown means CLIENT. */
    public static AccountType parse(String value) {
        if (value == null) return CLIENT;
        try {
            return AccountType.valueOf(value.trim().toUpperCase());
        } catch (IllegalArgumentException e) {
            return CLIENT;
        }
    }
}
