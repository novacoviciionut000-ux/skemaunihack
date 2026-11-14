package com.accessmap.auth.repository;

import com.accessmap.auth.model.AuthProvider;
import com.accessmap.auth.model.User;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.Optional;

@Repository
public interface UserRepository extends JpaRepository<User, Long> {

    Optional<User> findByUsername(String username);

    Optional<User> findByUsernameIgnoreCase(String username);

    Optional<User> findByEmail(String email);

    Optional<User> findByEmailIgnoreCase(String email);

    @Query("SELECT u FROM User u WHERE LOWER(u.username) = LOWER(:identifier) OR LOWER(u.email) = LOWER(:identifier)")
    Optional<User> findByUsernameOrEmail(@Param("identifier") String identifier);

    Optional<User> findByGoogleId(String googleId);

    Optional<User> findByFacebookId(String facebookId);

    Optional<User> findByProviderAndProviderId(AuthProvider provider, String providerId);

    boolean existsByUsernameIgnoreCase(String username);

    boolean existsByEmailIgnoreCase(String email);

    /** Volunteers with the most Deed points (leaderboard). */
    @Query("select u from User u where u.accountType = com.accessmap.auth.model.AccountType.VOLUNTEER "
            + "and u.deedPoints > 0 order by u.deedPoints desc, u.deedsCompleted desc")
    java.util.List<User> findTopVolunteers(org.springframework.data.domain.Pageable page);
}
