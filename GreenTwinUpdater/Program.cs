using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Azure.Functions.Worker;
using Azure.DigitalTwins.Core;
using Azure.Identity;
using System;
using Microsoft.Extensions.Logging; 

var host = new HostBuilder()
    .ConfigureFunctionsWebApplication()

    .ConfigureServices(services =>
    {
        services.AddApplicationInsightsTelemetryWorkerService();
        services.ConfigureFunctionsApplicationInsights();

        var adtServiceUrl = Environment.GetEnvironmentVariable("ADT_SERVICE_URL");
        if (string.IsNullOrEmpty(adtServiceUrl))
        {
            Console.Error.WriteLine("FATAL: ADT_SERVICE_URL environment variable is not set.");
            throw new InvalidOperationException("ADT_SERVICE_URL environment variable is not set.");
        }

        Console.WriteLine($"Registering DigitalTwinsClient for URL (HostBuilder): {adtServiceUrl}");

        services.AddSingleton(provider =>
        {
            var credential = new DefaultAzureCredential();
            try
            {
                return new DigitalTwinsClient(new Uri(adtServiceUrl), credential);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"FATAL: Failed to create DigitalTwinsClient: {ex}");
                throw;
            }
        });

    })
    .Build();

host.Run();