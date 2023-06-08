'use strict'

const map = require('lodash/map')
const isEmpty = require('lodash/isEmpty')
const filter = require('lodash/filter')
const groupBy = require('lodash/groupBy')
const cloneDeep = require('lodash/cloneDeep')
const set = require('lodash/set')
const unset = require('lodash/unset')
const isString = require('lodash/isString')
const uniqBy = require('lodash/uniqBy')
const keyBy = require('lodash/keyBy')
const zipObject = require('lodash/zipObject')
const isArray = require('lodash/isArray')
const imPatch = require('patchinko/immutable')
const differenceBy = require('lodash/differenceBy')
const intersectionBy = require('lodash/intersectionBy')
const flatMap = require('lodash/flatMap')
const isFunction = require('lodash/isFunction')
const pluralize = require('pluralize')
const {
  hasMany,
  hasManyThrough,
  hasOne,
  belongsTo,
  extendWith,
} = require('./relations')
const debug = require('debug')

const debugWith = (text, tableName) => {
  debug('hedy:with')(text)
  if (tableName) {
    debug(`hedy:${tableName}:with`)(text)
  }
}

function convertWhere(query, where, { like = false } = {}) {
  if (!where) {
    return imPatch(a => a)
  }
  if (isFunction(where)) {
    return imPatch(where)
  }
  where = Object.keys(where).reduce(function (newWhere, columnName) {
    let value = where[columnName]
    if (like && isString(where[columnName])) {
      value = { like: value }
    }
    newWhere[query.columns[columnName] || columnName] = value
    return newWhere
  }, {})
  return imPatch(oldWhere => imPatch(oldWhere, where))
}

function byMultiKey(multiKey) {
  return item => multiKey.map(key => item[key]).join('|||')
}

function parseOrderBy(orderBy) {
  if (isString(orderBy)) {
    return parseOrderBy([orderBy])
  }
  if (isArray(orderBy)) {
    return orderBy.map(function (column) {
      const [columnName, dir] = column.split(' ')
      return [columnName, dir || 'ASC']
    })
  }
  throw new Error('not implemented')
}

function isHasManyThoughRelation(relation) {
  return !!relation.throughQuery
}

function mapAsync(list, fn) {
  return Promise.all(map(list, fn))
}

module.exports = function (adapter, options = {}) {
  let mockAdapter

  if (options && options.pk && !isArray(options.pk)) {
    options.pk = [options.pk]
  }
  options = imPatch(
    {
      methods: {
        map,
        mapAsync,
        filter,
        groupBy,
        keyBy,
      },
    },
    { methods: imPatch(options.methods) }, // patch methods
    imPatch(options, {
      // patch rest
      methods: imPatch,
    })
  )

  function evolve(query, patch) {
    if (patch) {
      query = imPatch(query, {
        ...patch,
        relations: { ...query.relations },
      })
    }

    function whereFromId(id) {
      return zipObject(query.pk, isArray(id) ? id : [id])
    }

    function attachConverter(converter) {
      return fn =>
        evolve(query, {
          converter: imPatch(converters =>
            converters.concat(res => converter(res, fn))
          ),
        })
    }

    function get(id, { omitWhere } = {}) {
      return evolve(query, {
        offset: 0,
        limit: 1,
        returnArray: false,
        where: imPatch(oldWhere => ({
          ...(omitWhere ? {} : oldWhere),
          ...whereFromId(id),
        })),
      }).load()
    }

    async function adaptHasManyRelations(id, data) {
      const fromItem = await get(id, { omitWhere: true })
      const withRelations = Object.keys(query.withRelated).filter(r => data[r])
      await Promise.all(
        flatMap(withRelations, function (relationName) {
          const relation = query.relations[relationName]
          if (!isHasManyThoughRelation(relation)) {
            return
          }
          const newLinks = uniqBy(
            data[relationName],
            byMultiKey(relation.query.pk())
          )
          const existingLinks = fromItem[relationName]
          const toUnlink = differenceBy(
            existingLinks,
            newLinks,
            byMultiKey(relation.query.pk())
          )
          const toLink = differenceBy(
            newLinks,
            existingLinks,
            byMultiKey(relation.query.pk())
          )
          const toUpdate = intersectionBy(
            newLinks,
            existingLinks,
            byMultiKey(relation.query.pk())
          )
          return [
            relation.unlinkAll(toUnlink.map(toItem => [fromItem, toItem])),
            relation.linkAll(toLink.map(toItem => [fromItem, toItem])),
            relation.updateAll(toUpdate.map(toItem => [fromItem, toItem])),
          ]
        })
      )
    }

    const api = {
      table(tableName) {
        if (tableName) {
          return evolve(query, { tableName })
        }
        return query.tableName
      },

      columns(columns) {
        if (isArray(columns)) {
          const columnsToAdd = columns
          columns = currentColumns => [...currentColumns, ...columnsToAdd]
        }
        return evolve(query, { columns: imPatch(columns) })
      },
      writableColumns(columns) {
        if (isArray(columns)) {
          const columnsToAdd = columns
          columns = currentColumns => [
            ...(currentColumns || []),
            ...columnsToAdd,
          ]
        }
        return evolve(query, { writableColumns: imPatch(columns) })
      },
      pk(pk) {
        if (pk) {
          return evolve(query, {
            pk: isArray(pk) ? pk : [pk],
          })
        }
        return query.pk
      },

      get,
      where(where) {
        return evolve(query, { where: convertWhere(query, where) })
      },
      whereLike(where) {
        return evolve(query, {
          where: convertWhere(query, where, { like: true }),
        })
      },
      rawMap(fn) {
        return evolve(query, {
          rawMap: imPatch(oldRawMap => [...oldRawMap, fn]),
        })
      },

      with(...relations) {
        debugWith(
          `Activating relations ["${relations.join('", "')}"] of table "${
            query.tableName
          }"`,
          query.tableName
        )
        const withRelated = relations.reduce((wR, path) => {
          if (isString(path)) {
            return set(wR, path.replaceAll(':', '.'), true)
          }
          return { ...wR, ...path }
        }, cloneDeep(query.withRelated))
        return evolve(query, { withRelated })
      },

      without(...relations) {
        debugWith(
          `Deactivating relations ["${relations.join('", "')}"] of table "${
            query.tableName
          }"`,
          query.tableName
        )
        const withRelated = relations.reduce((wR, path) => {
          if (path === '*') {
            return {}
          }
          unset(wR, path.replaceAll(':', '.'))
          return wR
        }, cloneDeep(query.withRelated))
        return evolve(query, { withRelated })
      },

      hasMany(
        relationQuery,
        { relationKey = pluralize(relationQuery.table()) } = {}
      ) {
        query.relations[relationKey] = hasMany(relationQuery, {
          relationKey,
        })
        return evolve(query)
      },

      extendWith(
        relationQuery,
        {
          relationKey = relationQuery.table(),
          fk = `${relationQuery.table()}Id`,
        } = {}
      ) {
        query.relations[relationKey] = extendWith(relationQuery, {
          relationKey,
          fk,
        })
        return evolve(query)
      },

      belongsTo(
        relationQuery,
        {
          relationKey = relationQuery.table(),
          fk = `${relationQuery.table()}Id`,
        } = {}
      ) {
        query.relations[relationKey] = belongsTo(relationQuery, {
          relationKey,
          fk,
        })
        return evolve(query)
      },

      hasOne(relationQuery, { relationKey = relationQuery.table() } = {}) {
        query.relations[relationKey] = hasOne(relationQuery, {
          relationKey,
        })
        return evolve(query)
      },

      hasManyThrough(
        relationQuery,
        throughQuery,
        { relationKey = pluralize(relationQuery.table()), ...opts } = {}
      ) {
        query.relations[relationKey] = hasManyThrough(
          relationQuery,
          throughQuery,
          { relationKey, ...opts }
        )
        return evolve(query)
      },

      orderBy(columns) {
        return evolve(query, { orderBy: parseOrderBy(columns) })
      },

      limit(limit) {
        return evolve(query, { limit })
      },
      offset(offset) {
        return evolve(query, { offset })
      },

      count(columnName = true) {
        return evolve(query, { count: columnName, orderBy: [] }).load()
      },

      first(where) {
        return evolve(query, {
          limit: 1,
          returnArray: false,
          where: convertWhere(query, where),
        }).load()
      },

      async put(id, data) {
        if (!data) {
          throw new Error('no data provided for put')
        }
        await evolve(query, {
          type: 'put',
          where: whereFromId(id),
          returnArray: false,
          data,
        }).load()
        await adaptHasManyRelations(id, data)
        return data
      },

      putAll(data) {
        if (!data) {
          throw new Error('no data provided for put')
        }
        return evolve(query, {
          type: 'put',
          returnArray: true,
          data,
        }).load()
      },

      async post(data) {
        if (isEmpty(data)) {
          throw new Error('no data provided for post')
        }
        const result = await evolve(query, {
          type: 'post',
          returnArray: false,
          data,
        }).load()
        const id = query.pk.map(key => {
          data[key] = result[key]
          return result[key]
        })
        await adaptHasManyRelations(id, data)
        return data
      },

      async postAll(data) {
        if (isEmpty(data)) {
          return data
        }
        const resultList = await evolve(query, {
          type: 'post',
          returnArray: true,
          data,
        }).load()
        await mapAsync(resultList, async (result, index) => {
          const id = query.pk.map(key => {
            data[index][key] = result[key]
            return result[key]
          })
          await adaptHasManyRelations(id, data[index])
        })
        return data
      },

      del(id) {
        return evolve(query, {
          type: 'del',
          where: whereFromId(id),
          returnArray: false,
        }).load()
      },

      delAll() {
        return evolve(query, {
          type: 'del',
          returnArray: false,
        }).load()
      },

      load() {
        return (mockAdapter || adapter)[query.type](query)
      },

      query,
    }

    map(options.methods, function (method, methodName) {
      api[methodName] = attachConverter(method)
    })

    return api
  }

  function store(tableName) {
    return evolve({
      type: 'get',
      tableName,
      pk: ['id'],
      where: {},
      rawMap: [],
      converter: [],
      withRelated: {},
      returnArray: true,
      columns: [],
      writableColumns: null,
      orderBy: [],
      limit: Infinity,
      offset: 0,
      relations: {},
    })
  }

  store._mockAdapter = a => (mockAdapter = a)
  store._resetAdapter = () => (mockAdapter = null)
  return store
}
