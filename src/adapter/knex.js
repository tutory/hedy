'use strict'

const isArray = require('lodash/isArray')
const pick = require('lodash/pick')
const isEmpty = require('lodash/isEmpty')
const toNumber = require('lodash/toNumber')
const compact = require('lodash/compact')
const debug = require('debug')
const { format } = require('sql-formatter')
const { fetchRelations } = require('../relations')

const debugQuery = (query, tableName) => {
  const debugQ = debug('hedy:query')
  const debugTableQuery = debug(`hedy:${tableName}:query`)
  const queryStr =
    debugQ.enabled || debugTableQuery.enabled ? format(query.toString()) : ''
  debugQ(queryStr)
  tableName && debugTableQuery(queryStr)
}

const debugResult = (res, tableName) => {
  debug('hedy:res')(res)
  if (tableName) {
    debug(`hedy:${tableName}:res`)(res)
  }
}

function addWhereCondition(knexQuery, hedyQuery) {
  Object.keys(hedyQuery.where).map(key => {
    const value = hedyQuery.where[key]
    if (value == null) {
      return knexQuery.where(key, null)
    }
    if (!isArray(value)) {
      if (value.like) {
        return knexQuery.whereRaw('??::text ilike ?', [key, `%${value.like}%`])
      }
      return knexQuery.where(key, value)
    }
    if (value.length) {
      return knexQuery.whereIn(key, value)
    }
    return knexQuery.whereRaw('false')
  })
}

function getData({ pk, writableColumns, columns, data }) {
  const cols = [...pk, ...(writableColumns || columns)]
  return isArray(data) ? data.map(item => pick(item, cols)) : pick(data, cols)
}

module.exports = function (knex) {
  // eslint-disable-next-line complexity
  async function get(hedyQuery) {
    let knexQuery = knex(hedyQuery.tableName)
    knexQuery = hedyQuery.rawMap.reduce((q, fn) => fn(q, knex) || q, knexQuery)
    addWhereCondition(knexQuery, hedyQuery)

    knexQuery.orderBy(
      hedyQuery.orderBy.map(entry => ({ column: entry[0], order: entry[1] }))
    )

    knexQuery.offset(hedyQuery.offset)
    if (hedyQuery.limit < Infinity) {
      knexQuery.limit(hedyQuery.limit)
    }

    if (hedyQuery.count) {
      const columnNames =
        hedyQuery.count !== true
          ? [hedyQuery.count]
          : (isArray(hedyQuery.pk) ? hedyQuery.pk : [hedyQuery.pk]).map(
              c => `${hedyQuery.tableName}.${c}`
            )
      const countKnexQuery = knexQuery.count(...columnNames)
      debugQuery(countKnexQuery, hedyQuery.tableName)
      const res = await countKnexQuery
      debugResult(res)
      return toNumber(res[0].count)
    }

    if (hedyQuery.columns.length) {
      knexQuery.select(
        hedyQuery.columns.map(c => `${hedyQuery.tableName}.${c}`)
      )
    }
    debugQuery(knexQuery, hedyQuery.tableName)

    let list
    if (hedyQuery.returnArray) {
      list = await knexQuery
    } else {
      const item = await knexQuery.first()
      list = isEmpty(item) ? [] : [item]
    }
    list = compact(list)
    debugResult(list, hedyQuery.tableName)
    if (list.length) {
      await fetchRelations(list, hedyQuery)
      for (const converter of hedyQuery.converter) {
        list = await converter(list)
      }
    }
    if (hedyQuery.returnArray) {
      return list
    }
    return list[0]
  }

  async function post(hedyQuery) {
    const data = getData(hedyQuery)
    const query = knex(hedyQuery.tableName).insert(data)
    query.returning(hedyQuery.pk)
    debugQuery(query, hedyQuery.tableName)
    const list = await query
    debugResult(list, hedyQuery.tableName)
    if (hedyQuery.returnArray) {
      return list
    }
    return list[0]
  }

  async function put(hedyQuery) {
    const knexQuery = knex(hedyQuery.tableName)
    addWhereCondition(knexQuery, hedyQuery)
    const data = getData(hedyQuery)
    if (!isEmpty(data)) {
      const query = knexQuery.update(data)
      debugQuery(query, hedyQuery.tableName)
      await query
    }
  }

  function del(hedyQuery) {
    const knexQuery = knex(hedyQuery.tableName)
    addWhereCondition(knexQuery, hedyQuery)
    const query = knexQuery.del()
    debugQuery(query, hedyQuery.tableName)
    return query
  }

  return {
    get,
    put,
    post,
    del,
  }
}
