using System;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Azure;
using Azure.DigitalTwins.Core;
using Azure.Identity;
using Azure.Messaging.ServiceBus;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Logging;
using System.Collections.Generic;

namespace GreenTwinUpdater.Function
{
    public class IoTCentralTrigger
    {
        private readonly ILogger _logger;
        private readonly DigitalTwinsClient _client;

        public IoTCentralTrigger(ILoggerFactory loggerFactory, DigitalTwinsClient adtClient)
        {
            _logger = loggerFactory.CreateLogger<IoTCentralTrigger>();
            _client = adtClient;
        }

        [Function("IoTCentralTrigger")]
        public async Task RunAsync(
            [ServiceBusTrigger("iotcentral", Connection = "ServiceBusConnection")]
            ServiceBusReceivedMessage message)
        {
            string messageBody = "(unable to read body)";
            string? deviceId = null;

            try
            {
                messageBody = message.Body?.ToString();

                using JsonDocument jsonDoc = JsonDocument.Parse(messageBody);
                JsonElement root = jsonDoc.RootElement;

                if (!root.TryGetProperty("deviceId", out JsonElement deviceIdElement)
                    || deviceIdElement.ValueKind != JsonValueKind.String
                    || string.IsNullOrWhiteSpace(deviceIdElement.GetString()))
                    return;

                deviceId = deviceIdElement.GetString()!;

                if (!root.TryGetProperty("telemetry", out JsonElement telemetryElement)
                    || telemetryElement.ValueKind != JsonValueKind.Object)
                    return;

                var updatePatch = new JsonPatchDocument();
                var telemetryValues = new Dictionary<string, object>();
                int propertiesAdded = 0;

                foreach (var telemetryProperty in telemetryElement.EnumerateObject())
                {
                    string propertyName = telemetryProperty.Name;
                    string patchPath = $"/{propertyName}";

                    object? objectValue = telemetryProperty.Value.ValueKind switch
                    {
                        JsonValueKind.Number => telemetryProperty.Value.GetDouble(),
                        JsonValueKind.String => telemetryProperty.Value.GetString(),
                        JsonValueKind.True => true,
                        JsonValueKind.False => false,
                        _ => null
                    };

                    if (objectValue != null)
                    {
                        updatePatch.AppendReplace(patchPath, objectValue);
                        telemetryValues.Add(propertyName, objectValue);
                        propertiesAdded++;
                    }
                }

                if (propertiesAdded == 0)
                    return;

                try
                {
                    await _client.UpdateDigitalTwinAsync(deviceId, updatePatch);
                    _logger.LogInformation("Successfully 'Replaced' properties on twin '{DeviceId}'", deviceId);
                }
                catch (RequestFailedException replaceEx) when (replaceEx.Status == 400)
                {
                    _logger.LogWarning(replaceEx, "Failed to 'Replace' for twin '{DeviceId}'. Retrying with 'Add'...", deviceId);

                    var addPatch = new JsonPatchDocument();
                    foreach (var item in telemetryValues)
                    {
                        addPatch.AppendAdd($"/{item.Key}", item.Value);
                    }

                    await _client.UpdateDigitalTwinAsync(deviceId, addPatch);
                    _logger.LogInformation("Successfully 'Added' new properties to twin '{DeviceId}'", deviceId);
                }
            }
            catch (JsonException jsonEx)
            {
                _logger.LogError(jsonEx, "JSON Parsing error, SequenceNumber {SequenceNumber}. Body: {Body}", message.SequenceNumber, messageBody);
            }
            catch (RequestFailedException adtEx)
            {
                _logger.LogError(adtEx, "ADT API error for twin '{DeviceId}'. Status: {Status} ({ErrorCode}).", deviceId ?? "unknown", adtEx.Status, adtEx.ErrorCode ?? "N/A");

                if (adtEx.Status >= 500 || adtEx.Status == 429)
                {
                    throw;
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Unexpected error, SequenceNumber {SequenceNumber}. DeviceId: {DeviceId}", message.SequenceNumber, deviceId ?? "N/A");
                throw;
            }
        }
    }
}