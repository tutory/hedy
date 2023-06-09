# hedy

hedy is an ORM that focuses on the relation part and produces pojo's as result. It's backend is plugable, so you can use anything that has a CRUD-like interface, be it a normal database, a restful api or even a file.

## basic usage

```js
const hedy = require("hedy");

const simpleAdapter = {
  get: () => thing,
};
const store = hedy(simpleAdapter);
const query = store("things");
const result = await query.load();
result === thing;
```

So there are few things to unpack here.

### Adapter

The Adapter connects the query with the backend. It receives the generated query when `load()` is called. It may return any data.

### Store

The `store` is the initialized ORM with the adapter set to it. It is a function that creates queries when called. The only argument is the table name.

### Query

The `query` is a immutable data structure that has all relevant configurations to create the request to the backend via the adapter. It contains e. G. the table name, pagination, filter and columns.

It has some methods to change this configuration. Calling them always returns a new query instance, but never mutates the existing one.

Calling `load` the load method sends the constructed query to the respective adapter function.

## Relations

Relations are handled a little different from what you might know from existing ORM. Relations are handled as connections between queries. Since every query can have it's own backend, relations can also be defined between different backends. So you might connect you postgres data to you payment API transparently.

There are 5 possible relations you can use

### belongsTo

Source query has a foreign key to the target query

### hasOne,

Source queries primary key is a foreign key of one target query row

### hasMany

Source queries primary key is a foreign key of multiple target query rows

### hasManyThrough,

Source queries row is connected to target query row through a third query

### extendWith

Same as `hasOne` but it merges the related object to the this object in the result
