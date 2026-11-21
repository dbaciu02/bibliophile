# Load test results (scaling section of cost.md)

Commands: [cost.md → Load test and scaling](../cost.md#load-test-and-scaling-measured-on-staging).
Date and time of the runs: *(fill in)*. Target: staging. The JSON files the
script wrote are in [load/](load/).

| target | users | req/s | p50 ms | p95 ms | p99 ms | errors | CDN hit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| *(A: paste)* | | | | | | | |
| *(B: paste)* | | | | | | | |
| *(C, 1 user: paste)* | | | | | | | |
| *(C, 5 users: paste)* | | | | | | | |
| *(C, 10 users: paste)* | | | | | | | |
| *(C, 20 users: paste)* | | | | | | | |

Screenshots for the same minutes as run C:

- Grafana, "Bibliophile API — SLOs", `environment = staging`: latency (p95 by route) and request rate *(paste)*
- Render → bibliophile-api-staging → Metrics: CPU and memory *(paste)*
