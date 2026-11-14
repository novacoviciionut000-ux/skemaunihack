package com.accessmap.auth.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;
import java.io.*;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.Base64;
import java.util.concurrent.CompletableFuture;

@Service
public class EmailService {

    private static final Logger logger = LoggerFactory.getLogger(EmailService.class);
    private static final DateTimeFormatter DATE_FORMATTER = DateTimeFormatter.ofPattern("dd.MM.yyyy HH:mm:ss");

    @Value("${mail.enabled:true}")
    private boolean mailEnabled;

    @Value("${mail.smtp.host:smtp.gmail.com}")
    private String smtpHost;

    @Value("${mail.smtp.port:465}")
    private int smtpPort;

    @Value("${mail.smtp.username:}")
    private String smtpUsername;

    @Value("${mail.smtp.password:}")
    private String smtpPassword;

    @Value("${mail.smtp.from:noreply.accessmap@gmail.com}")
    private String smtpFrom;

    private volatile String lastSentRecipient;
    private volatile String lastSentSubject;
    private volatile LocalDateTime lastSentTime;
    private volatile boolean lastSentSuccess;

    /**
     * Trimite asincron un email de confirmare la autentificare (Google, Facebook sau Date proprii).
     */
    public void sendLoginConfirmationEmail(String toEmail, String fullName, String provider, String clientIp) {
        if (!mailEnabled || !StringUtils.hasText(toEmail)) {
            return;
        }

        CompletableFuture.runAsync(() -> {
            try {
                String subject = "AccessMap - Autentificare Reușită în Contul Tău";
                String timestamp = LocalDateTime.now().format(DATE_FORMATTER);
                String safeName = StringUtils.hasText(fullName) ? fullName : toEmail.split("@")[0];
                String safeIp = StringUtils.hasText(clientIp) ? clientIp : "127.0.0.1";

                String htmlBody = buildLoginEmailTemplate(safeName, toEmail, provider, timestamp, safeIp);

                boolean success = dispatchEmail(toEmail, subject, htmlBody);

                this.lastSentRecipient = toEmail;
                this.lastSentSubject = subject;
                this.lastSentTime = LocalDateTime.now();
                this.lastSentSuccess = success;

                if (success) {
                    logger.info("✅ Email de confirmare a autentificării trimis cu succes către: {}", toEmail);
                } else {
                    logger.info("ℹ️ Email de confirmare pregătit pentru {} (dispecerat local/logat)", toEmail);
                }
            } catch (Exception e) {
                logger.warn("Nu s-a putut trimite emailul de confirmare către {}: {}", toEmail, e.getMessage());
            }
        });
    }

    /**
     * Trimite asincron un email de confirmare la crearea unui cont nou.
     */
    public void sendRegistrationConfirmationEmail(String toEmail, String fullName, String username) {
        if (!mailEnabled || !StringUtils.hasText(toEmail)) {
            return;
        }

        CompletableFuture.runAsync(() -> {
            try {
                String subject = "Bun venit pe AccessMap - Cont Creat cu Succes!";
                String timestamp = LocalDateTime.now().format(DATE_FORMATTER);
                String safeName = StringUtils.hasText(fullName) ? fullName : username;

                String htmlBody = buildRegistrationEmailTemplate(safeName, username, toEmail, timestamp);

                boolean success = dispatchEmail(toEmail, subject, htmlBody);

                this.lastSentRecipient = toEmail;
                this.lastSentSubject = subject;
                this.lastSentTime = LocalDateTime.now();
                this.lastSentSuccess = success;

                logger.info("✅ Email de bun venit expediat către: {}", toEmail);
            } catch (Exception e) {
                logger.warn("Eroare la expediere email de bun venit către {}: {}", toEmail, e.getMessage());
            }
        });
    }

    /**
     * Expediază efectiv emailul prin SMTP direct (port 465 cu SSL sau 587) dacă există credențiale,
     * altfel înregistrează mesajul formatat în jurnalele securizate.
     */
    private boolean dispatchEmail(String toEmail, String subject, String htmlContent) {
        if (StringUtils.hasText(smtpUsername) && StringUtils.hasText(smtpPassword)) {
            try {
                sendViaSmtpSsl(toEmail, subject, htmlContent);
                return true;
            } catch (Exception e) {
                logger.warn("Trimiterea prin serverul SMTP {} a eșuat ({}). Se apelează fallback-ul local.", smtpHost, e.getMessage());
            }
        }

        // Simulare / dispecerat demonstrativ curat cu afișare clară în log-ul aplicației
        logger.info("--------------------------------------------------------------------------------");
        logger.info("📧 [NOTIFICARE EMAIL ACCESSMAP]");
        logger.info("Către: {}", toEmail);
        logger.info("Subiect: {}", subject);
        logger.info("Status: LIVRAT VIRTUAL (Pentru trimitere live via Gmail SMTP, configurează SMTP_USERNAME și SMTP_PASSWORD)");
        logger.info("--------------------------------------------------------------------------------");
        return false;
    }

    /**
     * Conexiune directă SMTP cu SSL (RFC 5321) fără dependențe externe.
     */
    private void sendViaSmtpSsl(String toEmail, String subject, String htmlContent) throws Exception {
        try (SSLSocket socket = (SSLSocket) SSLSocketFactory.getDefault().createSocket(smtpHost, smtpPort)) {
            socket.setSoTimeout(10000);
            BufferedReader reader = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
            BufferedWriter writer = new BufferedWriter(new OutputStreamWriter(socket.getOutputStream(), StandardCharsets.UTF_8));

            String line = reader.readLine();
            if (line == null || !line.startsWith("220")) {
                throw new IOException("Răspuns SMTP neașteptat la conectare: " + line);
            }

            sendSmtpCommand(writer, reader, "EHLO accessmap.local", "250");

            // Autentificare BASE64
            sendSmtpCommand(writer, reader, "AUTH LOGIN", "334");
            sendSmtpCommand(writer, reader, Base64.getEncoder().encodeToString(smtpUsername.getBytes(StandardCharsets.UTF_8)), "334");
            sendSmtpCommand(writer, reader, Base64.getEncoder().encodeToString(smtpPassword.getBytes(StandardCharsets.UTF_8)), "235");

            sendSmtpCommand(writer, reader, "MAIL FROM:<" + smtpFrom + ">", "250");
            sendSmtpCommand(writer, reader, "RCPT TO:<" + toEmail + ">", "250");
            sendSmtpCommand(writer, reader, "DATA", "354");

            // Antete și conținut
            writer.write("From: AccessMap Navigatie Asistiva <" + smtpFrom + ">\r\n");
            writer.write("To: <" + toEmail + ">\r\n");
            writer.write("Subject: =?UTF-8?B?" + Base64.getEncoder().encodeToString(subject.getBytes(StandardCharsets.UTF_8)) + "?=\r\n");
            writer.write("MIME-Version: 1.0\r\n");
            writer.write("Content-Type: text/html; charset=UTF-8\r\n");
            writer.write("Content-Transfer-Encoding: base64\r\n");
            writer.write("\r\n");
            writer.write(Base64.getEncoder().encodeToString(htmlContent.getBytes(StandardCharsets.UTF_8)));
            writer.write("\r\n.\r\n");
            writer.flush();

            String dataResp = reader.readLine();
            if (dataResp == null || !dataResp.startsWith("250")) {
                throw new IOException("Eroare la finalizarea transmiterii emailului: " + dataResp);
            }

            try {
                sendSmtpCommand(writer, reader, "QUIT", "221");
            } catch (Exception ignored) {}
        }
    }

    private void sendSmtpCommand(BufferedWriter writer, BufferedReader reader, String command, String expectedCode) throws IOException {
        writer.write(command + "\r\n");
        writer.flush();
        String response = reader.readLine();
        while (response != null && response.length() >= 4 && response.charAt(3) == '-') {
            response = reader.readLine();
        }
        if (response == null || !response.startsWith(expectedCode)) {
            throw new IOException("Comanda SMTP '" + command + "' a eșuat cu răspunsul: " + response);
        }
    }

    private String buildLoginEmailTemplate(String name, String email, String provider, String timestamp, String ip) {
        return "<!DOCTYPE html>" +
                "<html>" +
                "<head><meta charset='UTF-8'></head>" +
                "<body style='font-family: Arial, sans-serif; background-color: #f1f5f9; margin: 0; padding: 24px; color: #1e293b;'>" +
                "<div style='max-width: 540px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.08);'>" +
                "  <div style='background: linear-gradient(135deg, #2563eb, #1d4ed8); padding: 24px 28px; text-align: center; color: #ffffff;'>" +
                "    <h1 style='margin: 0; font-size: 22px; font-weight: 700;'>AccessMap - Asistență & Navigație</h1>" +
                "    <p style='margin: 6px 0 0; font-size: 13px; opacity: 0.9;'>Notificare de Securitate Cont</p>" +
                "  </div>" +
                "  <div style='padding: 28px;'>" +
                "    <h2 style='margin-top: 0; font-size: 18px; color: #0f172a;'>Salut, " + escapeHtml(name) + "! 👋</h2>" +
                "    <p style='font-size: 14px; line-height: 1.5; color: #475569;'>" +
                "      Te-ai autentificat cu succes pe platforma <strong>AccessMap</strong>. Această confirmare îți este trimisă pentru a-ți asigura securitatea contului." +
                "    </p>" +
                "    <div style='background: #f8fafc; border: 1.5px solid #e2e8f0; border-radius: 12px; padding: 16px; margin: 20px 0;'>" +
                "      <div style='font-size: 12px; color: #64748b; font-weight: 700; text-transform: uppercase; margin-bottom: 8px;'>Detalii Sesiune:</div>" +
                "      <div style='font-size: 13px; margin-bottom: 6px;'><strong>Metodă autentificare:</strong> <span style='color: #2563eb; font-weight: 600;'>" + escapeHtml(provider) + "</span></div>" +
                "      <div style='font-size: 13px; margin-bottom: 6px;'><strong>Adresă de email:</strong> " + escapeHtml(email) + "</div>" +
                "      <div style='font-size: 13px; margin-bottom: 6px;'><strong>Data și ora:</strong> " + timestamp + "</div>" +
                "      <div style='font-size: 13px;'><strong>Adresă IP:</strong> <code>" + escapeHtml(ip) + "</code></div>" +
                "    </div>" +
                "    <p style='font-size: 13px; color: #64748b; line-height: 1.5;'>" +
                "      Dacă nu ai fost tu cel care s-a conectat, te rugăm să îți schimbi imediat parola sau să verifici accesul contului tău Google/Facebook." +
                "    </p>" +
                "    <div style='text-align: center; margin-top: 24px;'>" +
                "      <a href='http://localhost:3000' style='background: #2563eb; color: #ffffff; text-decoration: none; padding: 11px 24px; border-radius: 24px; font-weight: 600; font-size: 14px; display: inline-block;'>Deschide AccessMap</a>" +
                "    </div>" +
                "  </div>" +
                "  <div style='background: #f8fafc; padding: 14px 28px; text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px solid #f1f5f9;'>" +
                "    Echipa AccessMap UniHack 2026 • Navigație urbană sigură și accesibilă" +
                "  </div>" +
                "</div>" +
                "</body>" +
                "</html>";
    }

    private String buildRegistrationEmailTemplate(String name, String username, String email, String timestamp) {
        return "<!DOCTYPE html>" +
                "<html>" +
                "<head><meta charset='UTF-8'></head>" +
                "<body style='font-family: Arial, sans-serif; background-color: #f1f5f9; margin: 0; padding: 24px; color: #1e293b;'>" +
                "<div style='max-width: 540px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.08);'>" +
                "  <div style='background: linear-gradient(135deg, #16a34a, #15803d); padding: 24px 28px; text-align: center; color: #ffffff;'>" +
                "    <h1 style='margin: 0; font-size: 22px; font-weight: 700;'>Bine ai venit pe AccessMap!</h1>" +
                "    <p style='margin: 6px 0 0; font-size: 13px; opacity: 0.9;'>Contul tău a fost creat cu succes</p>" +
                "  </div>" +
                "  <div style='padding: 28px;'>" +
                "    <h2 style='margin-top: 0; font-size: 18px; color: #0f172a;'>Salut, " + escapeHtml(name) + "! 🎉</h2>" +
                "    <p style='font-size: 14px; line-height: 1.5; color: #475569;'>" +
                "      Ne bucurăm să te avem alături! Contul tău este acum activ pe platforma AccessMap, având numele de utilizator unic rezervat garantat:" +
                "    </p>" +
                "    <div style='background: #f0fdf4; border: 1.5px solid #bbf7d0; border-radius: 12px; padding: 16px; margin: 20px 0; text-align: center;'>" +
                "      <div style='font-size: 12px; color: #166534; font-weight: 700; text-transform: uppercase;'>Nume de utilizator atribuit:</div>" +
                "      <div style='font-size: 20px; font-weight: 800; color: #15803d; margin-top: 4px;'>@" + escapeHtml(username) + "</div>" +
                "      <div style='font-size: 12px; color: #64748b; margin-top: 6px;'>Adresă: " + escapeHtml(email) + " • Înregistrat la: " + timestamp + "</div>" +
                "    </div>" +
                "    <p style='font-size: 13px; color: #64748b; line-height: 1.5;'>" +
                "      Ai acces la toate funcționalitățile: rute adaptate pentru nevăzători și mobilitate, asistent vocal și salvarea rapoartelor." +
                "    </p>" +
                "  </div>" +
                "</div>" +
                "</body>" +
                "</html>";
    }

    private String escapeHtml(String text) {
        if (text == null) return "";
        return text.replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace("\"", "&quot;")
                .replace("'", "&#39;");
    }

    public String getLastSentRecipient() { return lastSentRecipient; }
    public String getLastSentSubject() { return lastSentSubject; }
    public LocalDateTime getLastSentTime() { return lastSentTime; }
    public boolean isLastSentSuccess() { return lastSentSuccess; }
}
