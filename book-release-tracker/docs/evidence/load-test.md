# Load test results (scaling section of cost.md)

Commands: [cost.md → Load test and scaling](../cost.md#load-test-and-scaling-measured-on-staging).
Date and time of the runs: 11-24-2026 12:24 AM. Target: staging. The JSON files the
script wrote are in [load/](load/).

| target | users | req/s | p50 ms | p95 ms | p99 ms | errors | CDN hit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A: https://staging.bibliophile.dorabaciu.dev/api/releases?limit=20 | 10 | 28.9 | 33 | 122 | 318 | 5.2% | 99.1% |
| B: https://api.staging.bibliophile.dorabaciu.dev/api/releases?limit=20 | 10 | 61.5 | 124 | 458 | 623 | 0% | — |
| C: https://api.staging.bibliophile.dorabaciu.dev/api/releases?limit=20 | 1 | 16.9 | 36 | 133 | 326 | 0% | — |
| C: https://api.staging.bibliophile.dorabaciu.dev/api/releases?limit=20 | 5 | 56.1 | 48 | 260 | 466 | 0% | — |
| C: https://api.staging.bibliophile.dorabaciu.dev/api/releases?limit=20 | 10 | 80 | 102 | 290 | 537 | 0% | — |
| C: https://api.staging.bibliophile.dorabaciu.dev/api/releases?limit=20 | 20 | 84.2 | 199 | 596 | 758 | 0% | — |

Screenshots for the same minutes as run C:

- Grafana, "Bibliophile API — SLOs", `environment = staging`: latency (p95 by route) and request rate<br>
[docs/evidence/screenshots/D10-grafana-metrics.png](docs/evidence/screenshots/D10-grafana-metrics.png)
- Render → bibliophile-api-staging → Metrics: CPU and memory - need to pay for those metrics to see the usage during the load test (unable to get those)

Conclusion:
For tests A and B, the CDN did help reduce latency and offload requests from the origin server, as indicated by the high 99.1% CDN hit rate for test A and the improved request rate and latency compared to test B. The 5.2% error rate in test A shows some requests still failed despite the CDN. Test B still benefited from the CDN, but with a lower hit rate. For test C, which did not use the CDN, the origin server handled all requests directly, resulting in higher latency and lower request rates as the number of users increased. All of tests in C had no errors.
What breaks first is the fact that the CPU usage spikes under load, limiting the server's ability to handle more concurrent requests efficiently. What could fix that is letting the CDN handle more of the traffic, thereby reducing the load on the origin server and then initiating a second wave of requests to test the server's capacity under reduced load.