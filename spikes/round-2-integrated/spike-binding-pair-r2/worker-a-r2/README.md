# spike-binding-pair-r2 worker-a (caller)

> Expiration: 2026-08-01
> Role: caller driving `binding-F01` (callee abort) and `binding-F04`
> (true callback push to worker-b's `BoundedEvalSink`) plus
> `binding-F02`/`binding-F03` re-validation against shipped packages.

## Routes

```
GET  /healthz                                                 liveness
GET  /healthz/binding                                         sanity-check WORKER_B binding
POST /probe/follow-ups/binding-f01-callee-abort               binding-F01 follow-up
POST /probe/follow-ups/binding-f04-true-callback              binding-F04 follow-up
POST /probe/re-validation/binding                             binding-F02/F03 via shipped seam
GET  /inspect/last-run                                        echo of last result
```

The binding-F04 follow-up is the **critical** proof that B6 dedup /
overflow disclosure holds on a true push path. See
`src/follow-ups/binding-f04-true-callback.ts` for the pushed-batch
shape and the assertions.
