'use strict'

const keyBy = require('lodash/keyBy')
const map = require('lodash/map')
const uniq = require('lodash/uniq')
const isEmpty = require('lodash/isEmpty')
const omit = require('lodash/omit')
const defaults = require('lodash/defaults')
const compact = require('lodash/compact')
const NO_RELATED_ITEM_FOUND = {}
const pluralize = require('pluralize')
const debug = require('debug')
const isObject = require('lodash/isObject')

const PARENT_TABLE_NAME_ID = 'parentTableNameId'

const debugFetchRelations = (relations, list, tableName) => {
  debug('hedy:fetchRelations')(relations)
  debug('hedy:fetchRelations:list')(list)
  debug(`hedy:${tableName}:fetchRelations`)(relations)
  debug(`hedy:${tableName}:fetchRelations:list`)(list)
}
const debugAddRelation = (relation, tableName) => {
  debug('hedy:addRelation')(relation)
  debug(`hedy:${tableName}:addRelation`)(relation)
}

const get = key => entity => entity[key]

function wrapApi(relation) {
  return {
    ...relation,
    with: relationPath =>
      wrapApi({
        ...relation,
        query: relation.query.with(relationPath),
      }),
    fetch: (list, parentQuery) => relation.fetch(relation, list, parentQuery),
  }
}

function belongsTo(
  query,
  {
    relationKey = query.table(),
    fk = `${query.table()}Id`,
    filter = a => a,
  } = {}
) {
  const relation = {
    query,
    relationKey,
    fk,
    pk: query.pk(),
    filter,
    async fetch(rel, list) {
      const fks = uniq(compact(list.filter(rel.filter).map(get(rel.fk))))
      if (!fks.length) {
        return list
      }
      const relatedItems = await rel.query.where({ [rel.pk]: fks }).load()
      const relatedItemsByPk = keyBy(relatedItems, rel.pk[0])
      return list
        .map(item => {
          const relatedItem = relatedItemsByPk[item[rel.fk]]
          if (relatedItem) {
            item[rel.relationKey] = relatedItem
          }
          return item
        })
        .filter(i => i !== NO_RELATED_ITEM_FOUND)
    },
  }
  return wrapApi(relation)
}

function extendWith(
  query,
  {
    relationKey = query.table(),
    fk = `${query.table()}Id`,
    filter,
    pk = query.pk(),
  } = {}
) {
  const relation = {
    query,
    relationKey,
    fk,
    pk,
    filter,
    async fetch(rel, list) {
      const filteredList = rel.filter ? list.filter(rel.filter) : list
      const fks = uniq(compact(filteredList.map(get(rel.fk))))
      if (!fks.length) {
        return list
      }
      const relatedItems = await rel.query.where({ [rel.pk]: fks }).load()
      const relatedItemsByPk = keyBy(relatedItems, rel.pk[0])
      filteredList.map(item => {
        const relatedItem = relatedItemsByPk[item[rel.fk]]
        if (!relatedItem) {
          return NO_RELATED_ITEM_FOUND
        }
        defaults(item, relatedItem)
        return item
      })
      return list.filter(i => i !== NO_RELATED_ITEM_FOUND)
    },
  }
  debugAddRelation(
    {
      type: 'extendWith',
      tableName: query.table(),
      fk: relation.fk,
      pk: relation.pk,
      relationKey: relation.relationKey,
    },
    query.table()
  )
  return wrapApi(relation)
}

function hasMany(
  query,
  {
    relationKey = pluralize(query.table()),
    pk = query.pk(),
    fk = PARENT_TABLE_NAME_ID,
    filter,
  }
) {
  const relation = {
    query,
    relationKey,
    pk,
    fk,
    filter,
    async fetch(rel, list, parentQuery) {
      const filteredList = rel.filter ? list.filter(rel.filter) : list
      rel.fk =
        rel.fk === PARENT_TABLE_NAME_ID ? `${parentQuery.tableName}Id` : rel.fk
      const relatedItemsByFK = await rel.query
        .where({ [rel.fk]: filteredList.map(get(parentQuery.pk)) })
        .groupBy(rel.fk)
        .load()
      filteredList.map(
        item => (item[rel.relationKey] = relatedItemsByFK[item.id] || [])
      )
      return list
    },
  }
  debugAddRelation(
    {
      type: 'hasMany',
      tableName: query.table(),
      fk: relation.fk,
      pk: relation.pk,
      relationKey: relation.relationKey,
    },
    query.table()
  )
  return wrapApi(relation)
}

function hasOne(
  query,
  {
    relationKey = query.table(),
    pk = query.pk(),
    fk = PARENT_TABLE_NAME_ID,
    filter,
  }
) {
  const relation = {
    relationKey,
    query,
    pk,
    filter,
    fk,
    async fetch(rel, list, parentQuery) {
      const filteredList = rel.filter ? list.filter(rel.filter) : list
      rel.fk =
        rel.fk === PARENT_TABLE_NAME_ID ? `${parentQuery.tableName}Id` : rel.fk
      const relatedItemsByFk = await rel.query
        .where({ [rel.fk]: filteredList.map(get(rel.pk)) })
        .keyBy(rel.fk)
        .load()
      filteredList.map(
        item => (item[rel.relationKey] = relatedItemsByFk[item.id])
      )
      return list
    },
  }
  debugAddRelation(
    {
      type: 'hasOne',
      tableName: query.table(),
      pk: relation.pk,
      fk: relation.fk,
      relationKey: relation.relationKey,
    },
    query.table()
  )

  return wrapApi(relation)
}

function hasManyThrough(
  query,
  throughQuery,
  {
    fromPk = 'id',
    fromFk = PARENT_TABLE_NAME_ID,
    toPk = 'id',
    toFk = `${query.table()}Id`,
    relationKey = pluralize(query.table()),
    includeFks = false,
    filter,
  }
) {
  const relation = {
    relationKey,
    query,
    throughQuery,
    fromPk,
    fromFk,
    toPk,
    toFk,
    filter,
    async fetch(rel, list, parentQuery) {
      fromFk =
        rel.fromFk === PARENT_TABLE_NAME_ID
          ? `${parentQuery.tableName}Id`
          : rel.fromFk
      const filteredList = rel.filter ? list.filter(rel.filter) : list
      const linkItems = await throughQuery
        .columns([fromFk, toFk])
        .where({ [fromFk]: uniq(filteredList.map(get(fromPk))) })
        .load()
      const toItemsByPk =
        linkItems.length === 0
          ? {}
          : await rel.query
              .where({ [toPk]: uniq(linkItems.map(get(toFk))) })
              .keyBy(toPk)
              .load()
      filteredList.map(item => {
        item[relationKey] = linkItems
          .filter(l => l[fromFk] === item[fromPk] && toItemsByPk[l[toFk]])
          .map(l => ({
            ...toItemsByPk[l[toFk]],
            ...omit(l, includeFks ? [] : [fromFk, toFk]),
          }))
      })
      return list
    },
    link(itemA, itemB) {
      const data = {
        ...itemB,
        [fromFk]: itemA[fromPk],
        [toFk]: itemB[toPk],
      }
      return throughQuery.post(data)
    },
    linkAll(pairs) {
      if (isEmpty(pairs)) {
        return
      }
      const data = pairs.map(([itemA, itemB]) => ({
        ...itemB,
        [fromFk]: itemA[fromPk],
        [toFk]: itemB[toPk],
      }))
      return throughQuery.postAll(data)
    },
    unlink(itemA, itemB) {
      return throughQuery
        .where({ [fromFk]: itemA[fromPk], [toFk]: itemB[toPk] })
        .delAll()
    },
    unlinkAll(pairs) {
      if (isEmpty(pairs)) {
        return
      }
      return mapAsync(pairs, ([itemA, itemB]) =>
        throughQuery
          .where({ [fromFk]: itemA[fromPk], [toFk]: itemB[toPk] })
          .delAll()
      )
    },
    update(itemA, itemB) {
      const data = {
        ...itemB,
        [fromFk]: itemA[fromPk],
        [toFk]: itemB[toPk],
      }
      return throughQuery.put([itemA[fromPk], itemB[toPk]], data)
    },
    updateAll(pairs) {
      if (isEmpty(pairs)) {
        return
      }
      return mapAsync(pairs, ([itemA, itemB]) => {
        const data = {
          ...itemB,
          [fromFk]: itemA[fromPk],
          [toFk]: itemB[toPk],
        }
        return throughQuery.put([itemA[fromPk], itemB[toPk]], data)
      })
    },
  }
  debugAddRelation(
    {
      type: 'hasManyThrough',
      tableName: query.table(),
      throughTableName: throughQuery.table(),
      toPk: relation.toPk,
      toFk: relation.toFk,
      relationKey: relation.relationKey,
      fromFk: relation.fromFk || PARENT_TABLE_NAME_ID,
    },
    query.table()
  )
  return wrapApi(relation)
}

function getRelation(relationName, subRelations, query) {
  const relation = query.relations[relationName]
  if (!relation) {
    const possibleRelationKeys = Object.keys(query.relations)
    throw new Error(
      `Unknown relation "${relationName}" for query on table "${
        query.tableName
      }", possible relations are "${possibleRelationKeys.join('", "')}"`
    )
  }
  if (isObject(subRelations)) {
    return relation.with(subRelations)
  }
  return relation
}

function mapAsync(list, fn) {
  return Promise.all(map(list, fn))
}

async function fetchRelations(list, query) {
  if (isEmpty(list) || isEmpty(query.withRelated)) {
    return
  }
  debugFetchRelations(query.withRelated, list, query.tableName)
  await mapAsync(query.withRelated, (subRelations, relation) =>
    getRelation(relation, subRelations, query).fetch(list, query)
  )
}

module.exports = {
  belongsTo,
  extendWith,
  hasMany,
  hasManyThrough,
  hasOne,
  fetchRelations,
}
