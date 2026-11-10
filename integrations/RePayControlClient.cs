using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
namespace RePay.WhatsAppPoc.Services;

// Optional, best-effort telemetry. Existing /api/analytics remains the historical source.
public sealed class RePayControlClient(HttpClient http, IConfiguration configuration, ILogger<RePayControlClient> logger)
{
    private string Hash(string value, string key) => Convert.ToHexString(HMACSHA256.HashData(Encoding.UTF8.GetBytes(key), Encoding.UTF8.GetBytes(value))).ToLowerInvariant();
    public async Task ObserveWebhookAsync(string payload, CancellationToken ct)
    {
        var origin = configuration["RePayControl:Origin"];
        var key = configuration["RePayControl:ServerKey"];
        if (string.IsNullOrWhiteSpace(key) || !Uri.TryCreate(origin, UriKind.Absolute, out var uri) || uri.Scheme != "https") return;
        try
        {
            var events = new List<object>();
            using var json = JsonDocument.Parse(payload);
            if (!json.RootElement.TryGetProperty("entry", out var entries)) return;
            foreach (var entry in entries.EnumerateArray())
            foreach (var change in entry.GetProperty("changes").EnumerateArray())
            {
                var value = change.GetProperty("value");
                if (!value.TryGetProperty("metadata", out var metadata) || !metadata.TryGetProperty("phone_number_id", out var phoneId)
                    || phoneId.GetString() != configuration["RePay:MetaPhoneNumberId"]) continue;
                if (value.TryGetProperty("messages", out var messages)) foreach (var message in messages.EnumerateArray())
                {
                    if (!message.TryGetProperty("id", out var id) || !message.TryGetProperty("from", out var from)) continue;
                    events.Add(new { id = Hash("received:" + id.GetString(), key), project = "poc", name = "message_received", userId = Hash("user:" + from.GetString(), key), path = "/webhooks/whatsapp" });
                }
                if (value.TryGetProperty("statuses", out var statuses)) foreach (var status in statuses.EnumerateArray())
                {
                    if (!status.TryGetProperty("id", out var id) || !status.TryGetProperty("status", out var state)) continue;
                    var name = state.GetString() switch { "sent" => "message_sent", "delivered" => "message_delivered", "failed" => "message_failed", _ => null };
                    if (name is null) continue;
                    events.Add(new { id = Hash(name + ":" + id.GetString(), key), project = "poc", name, path = "/webhooks/whatsapp" });
                }
            }
            foreach (var batch in events.Chunk(40))
            {
                using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct); timeout.CancelAfter(TimeSpan.FromMilliseconds(1500));
                using var request = new HttpRequestMessage(HttpMethod.Post, new Uri(uri, "/api/server-events"));
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", key);
                request.Content = JsonContent.Create(new { events = batch });
                using var response = await http.SendAsync(request, timeout.Token);
                if (!response.IsSuccessStatusCode) logger.LogWarning("RePayControl telemetry rejected: {Status}", (int)response.StatusCode);
            }
        }
        catch (Exception) when (!ct.IsCancellationRequested) { logger.LogWarning("RePayControl unavailable; webhook processing continues"); }
    }
}
