# spike-binding-pair-r2 worker-b (callee)

> Expiration: 2026-08-01
> Role: callee that owns `BoundedEvalSink` for `binding-F04` true push
> path.

## Routes

```
GET  /healthz                              liveness
POST /echo                                 response-body round-trip (binding baseline)
POST /slow                                 slow path, observes abort (binding-F01)
POST /sink/ingest                          accept eval record push (binding-F04)
GET  /sink/stats                           BoundedEvalSink stats snapshot
GET  /sink/disclosure                      BoundedEvalSink overflow disclosure ring buffer
POST /sink/reset                           reset sink to an empty state
GET  /headers/dump                         re-validation binding-F02 (lowercase law)
POST /hooks/dispatch                       re-validation binding-F03 (hook broadcast)
```

The key route for B7 is `POST /sink/ingest`: worker-a pushes a JSON
body carrying `{record, messageUuid}` pairs, and worker-b's sink
applies the B6 dedup + overflow disclosure contract. `GET /sink/stats`
then lets worker-a verify that `duplicateDropCount` /
`capacityOverflowCount` reflect the push path exactly.
