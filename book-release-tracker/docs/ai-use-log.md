# AI use log (Q3 / deliverable 8)

| Date | Tool | What I asked for | What it produced | What I changed / verified myself |
| --- | --- | --- | --- | --- |
| 2026-10-22 | Claude | Project plan mapped to the requirements checklist; Entra ID chosen as OIDC provider | Plan: stack, data model, routes, build order | Made sure the plan aligned with the requirements checklist |
| 2026-10-22 | Claude | Step 1 skeleton: repo layout, initial reversible migration, `/healthz`, error shape, request ids, release-date normalization + tests, React/TS shell, Entra setup guide | All files in the first commit | Verified shell was to my liking as well as the initial migration and test setup |
| 2026-11-02 | Claude | Step 2: Implement Entra ID authentication in the web client | Web client configured with Vite environment variables for Entra ID | Verified login flow, checked network requests, ensured tokens are correctly handled |
| 2026-11-03 | Claude | Step 3: Implement Entra ID authentication in the API | API configured with environment variables for Entra ID | Verified token, logged in successfully, checked network requests, ensured correct handling of authentication |
| 2026-11-12 | Claude | Step 4: Configure audit logging for API actions | API configured to log audit entries for each action | Verified audit entries were correctly logged for each API action and reran to catch any errors |
| 2026-11-13 | Claude | Step 4: Configure audit logging for API actions | API configured to log audit entries for each action | verified correct tokens and request IDs as well as HTTP request linkage |
| 2026-11-13 | Claude | Step 5: Integrate Google Books API | API configured to use Google Books API key | Verified API requests, checked responses, ensured correct handling of API key |
| 2026-11-18 | Claude | Step 6: Implement book release tracking | API and web client updated to track book releases | Verified logic, told Claude to make any changes, checked database entries, ensured correct handling of release dates |
| 2026-11-18 | Claude | Create synthetic book data | API and web client updated to track book releases | Verified synthetic data appeared in web client and database |
| 2026-11-18 | Claude | Step 7: Added MCP app | MCP app integrated with the API and web client | Verified MCP app functionality, checked API calls, ensured correct handling of authorization and tokens |
| 2026-11-20 | Claudde | Step 8: Deployment | Deployment scripts and environment configured for staging and production | Verified deployment process, checked environment variables, ensured correct handling of different environments |
| 2026-11-20 | Claude | Step 9: Operations| Walked through collecting evidence for operations | Verified collection of evidence, checked observability, cost, runbook, and Game Day documentation |
| Last 4 days | Claude | Reviewed recent AI outputs and had AI rewrite code as needed, checked code and reviewed errors and sent back corrections to the AI | Verified that the AI's changes were correct and consistent with project requirements |


## Challenged AI claim

11-24-2026
While collecting evidence for the load-test, Claude indicated that the catalog was cached by the CDN on both environments, and the post-deploy smoke check ("catalog response carries CDN cache headers") passed. So, I verified by running the commands for the load-test and found that the CDN was not actually caching the catalog responses as expected. Load-test run A showed a 0% CDN hit rate and 9.5% errors. Comparing headers showed staging sent no netlify-cdn-cache-control, and production rejected ?v=. /healthz showed staging running commit 0ba8792, which isn't in my history. What had happened was that Claude misinterpreted the smoke check results and assumed caching was working correctly when it was not. I then investigated the deployment process and Claude relaized that the env vars in Render ("Save, rebuild, and deploy") had redeployed the image from service setup, not the pipeline's latest. Fixed by re-running deploy and promote; run A then showed a 99.1% hit rate. The smoke check was too weak (Netlify always sends cache-status). Added a runbook note.