'use strict'

// Note: This file was yanked from graphql until PRs start merging..
// it executes observe instead of resolve

// This file is ignored by coverage

/**
 *  Copyright (c) 2015, Facebook, Inc.
 *  All rights reserved.
 *
 *  This source code is licensed under the BSD-style license found in the
 *  LICENSE file in the root directory of this source tree. An additional grant
 *  of patent rights can be found in the PATENTS file in the same directory.
 */

var iterall = require('iterall')
var forEach = iterall.forEach
var isCollection = iterall.isCollection

var graphqlError = require('graphql/error')
var GraphQLError = graphqlError.GraphQLError
var locatedError = graphqlError.locatedError
var typeFromAST = require('graphql/utilities/typeFromAST').typeFromAST
var Kind = require('graphql/language').Kind

var find = require('graphql/jsutils/find').default
var invariant = require('graphql/jsutils/invariant').default
var isNullish = require('graphql/jsutils/isNullish').default

var graphqlValues = require('graphql/execution/values')
var getVariableValues = graphqlValues.getVariableValues
var getArgumentValues = graphqlValues.getArgumentValues

var graphqlType = require('graphql/type/definition')
var GraphQLScalarType = graphqlType.GraphQLScalarType
var GraphQLObjectType = graphqlType.GraphQLObjectType
var GraphQLEnumType = graphqlType.GraphQLEnumType
var GraphQLList = graphqlType.GraphQLList
var GraphQLNonNull = graphqlType.GraphQLNonNull
var GraphQLInterfaceType = graphqlType.GraphQLInterfaceType
var GraphQLUnionType = graphqlType.GraphQLUnionType
var isAbstractType = graphqlType.isAbstractType

var GraphQLSchema = require('graphql/type/schema').GraphQLSchema
var graphqlIntrospection = require('graphql/type/introspection')
var SchemaMetaFieldDef = graphqlIntrospection.SchemaMetaFieldDef
var TypeMetaFieldDef = graphqlIntrospection.TypeMetaFieldDef
var TypeNameMetaFieldDef = graphqlIntrospection.TypeNameMetaFieldDef

var graphqlDirectives = require('graphql/type/directives')
var GraphQLIncludeDirective = graphqlDirectives.GraphQLIncludeDirective
var GraphQLSkipDirective = graphqlDirectives.GraphQLSkipDirective

/**
 * Terminology
 *
 * "Definitions" are the generic name for top-level statements in the document.
 * Examples of this include:
 * 1) Operations (such as a query)
 * 2) Fragments
 *
 * "Operations" are a generic name for requests in the document.
 * Examples of this include:
 * 1) query,
 * 2) mutation
 *
 * "Selections" are the definitions that can appear legally and at
 * single level of the query. These include:
 * 1) field references e.g "a"
 * 2) fragment "spreads" e.g. "...c"
 * 3) inline fragment "spreads" e.g. "...on Type { a }"
 */

/**
 * Data that must be available at all points during query execution.
 *
 * Namely, schema of the type system that is currently executing,
 * and the fragments defined in the query document
 */


/**
 * The result of execution. `data` is the result of executing the
 * query, `errors` is null if no errors occurred, and is a
 * non-empty array if an error occurred.
 */

/**
 * Implements the "Evaluating requests" section of the GraphQL specification.
 *
 * Returns a Promise that will eventually be resolved and never rejected.
 *
 * If the arguments to this function do not result in a legal execution context,
 * a GraphQLError will be thrown immediately explaining the invalid input.
 */
/* istanbul ignore next */
module.exports = function execute(schema, documentAST, rootValue, contextValue, variableValues, operationName) {
  invariant(schema, 'Must provide schema');
  invariant(schema instanceof GraphQLSchema, 'Schema must be an instance of GraphQLSchema. Also ensure that there are ' + 'not multiple versions of GraphQL installed in your node_modules directory.');

  // If a valid context cannot be created due to incorrect arguments,
  // this will throw an error.
  const context = buildExecutionContext(schema, documentAST, rootValue, contextValue, variableValues, operationName);

  // Return a Promise that will eventually resolve to the data described by
  // The "Response" section of the GraphQL specification.
  //
  // If errors are encountered while executing a GraphQL field, only that
  // field and its descendants will be omitted, and sibling fields will still
  // be executed. An execution which encounters errors will still result in a
  // resolved Promise.
  return new Promise(resolve => {
    resolve(executeOperation(context, context.operation, rootValue));
  }).catch(error => {
    // Errors from sub-fields of a NonNull type may propagate to the top level,
    // at which point we still log the error and null the parent field, which
    // in this case is the entire response.
    context.errors.push(error);
    return null;
  }).then(data => {
    if (!context.errors.length) {
      return { data };
    }
    return { data, errors: context.errors };
  });
}

/**
 * Constructs a ExecutionContext object from the arguments passed to
 * execute, which we will pass throughout the other execution methods.
 *
 * Throws a GraphQLError if a valid execution context cannot be created.
 */
/* istanbul ignore next */
function buildExecutionContext(schema, documentAST, rootValue, contextValue, rawVariableValues, operationName) {
  const errors = [];
  let operation;
  const fragments = Object.create(null);
  documentAST.definitions.forEach(definition => {
    switch (definition.kind) {
      case Kind.OPERATION_DEFINITION:
        if (!operationName && operation) {
          throw new GraphQLError('Must provide operation name if query contains multiple operations.');
        }
        if (!operationName || definition.name && definition.name.value === operationName) {
          operation = definition;
        }
        break;
      case Kind.FRAGMENT_DEFINITION:
        fragments[definition.name.value] = definition;
        break;
      default:
        throw new GraphQLError(`GraphQL cannot execute a request containing a ${ definition.kind }.`, [definition]);
    }
  });
  if (!operation) {
    if (operationName) {
      throw new GraphQLError(`Unknown operation named "${ operationName }".`);
    } else {
      throw new GraphQLError('Must provide an operation.');
    }
  }
  const variableValues = getVariableValues(schema, operation.variableDefinitions || [], rawVariableValues || {});

  return {
    schema,
    fragments,
    rootValue,
    contextValue,
    operation,
    variableValues,
    errors
  };
}

/**
 * Implements the "Evaluating operations" section of the spec.
 */
/* istanbul ignore next */
function executeOperation(exeContext, operation, rootValue) {
  const type = getOperationRootType(exeContext.schema, operation);
  const fields = collectFields(exeContext, type, operation.selectionSet, Object.create(null), Object.create(null));

  const path = [];

  // if (operation.operation === 'mutation') {
  //   return executeFieldsSerially(exeContext, type, rootValue, path, fields);
  // }
  return executeFields(exeContext, type, rootValue, path, fields);
}

/**
 * Extracts the root type of the operation from the schema.
 */
/* istanbul ignore next */
function getOperationRootType(schema, operation) {
  switch (operation.operation) {
    case 'query':
      return schema.getQueryType();
    case 'mutation':
      const mutationType = schema.getMutationType();
      if (!mutationType) {
        throw new GraphQLError('Schema is not configured for mutations', [operation]);
      }
      return mutationType;
    case 'subscription':
      const subscriptionType = schema.getSubscriptionType();
      if (!subscriptionType) {
        throw new GraphQLError('Schema is not configured for subscriptions', [operation]);
      }
      return subscriptionType;
    default:
      throw new GraphQLError('Can only execute queries, mutations and subscriptions', [operation]);
  }
}

/**
 * Implements the "Evaluating selection sets" section of the spec
 * for "write" mode.
 */
// function executeFieldsSerially(exeContext, parentType, sourceValue, path, fields) {
//   return Object.keys(fields).reduce((prevPromise, responseName) => prevPromise.then(results => {
//     const fieldASTs = fields[responseName];
//     const fieldPath = path.concat([responseName]);
//     const result = resolveField(exeContext, parentType, sourceValue, fieldASTs, fieldPath);
//     if (result === undefined) {
//       return results;
//     }
//     if (isThenable(result)) {
//       return result.then(resolvedResult => {
//         results[responseName] = resolvedResult;
//         return results;
//       });
//     }
//     results[responseName] = result;
//     return results;
//   }), Promise.resolve({}));
// }

/**
 * Implements the "Evaluating selection sets" section of the spec
 * for "read" mode.
 */
/* istanbul ignore next */
function executeFields(exeContext, parentType, sourceValue, path, fields) {
  let containsPromise = false;
  const responseName = Object.keys(fields)[0]
  const fieldASTs = fields[responseName];
  const fieldPath = path.concat([responseName]);
  const result = resolveField(exeContext, parentType, sourceValue, fieldASTs, fieldPath);
  return result;
  // }, Object.create(null));

  // If there are no promises, we can just return the object
  // if (!containsPromise) {
  // return finalResults[fields];
  // }

  // // Otherwise, results is a map from field name to the result
  // // of resolving that field, which is possibly a promise. Return
  // // a promise that will return this same map, but with any
  // // promises replaced with the values they resolved to.
  // return promiseForObject(finalResults);
}

/**
 * Given a selectionSet, adds all of the fields in that selection to
 * the passed in map of fields, and returns it at the end.
 *
 * CollectFields requires the "runtime type" of an object. For a field which
 * returns and Interface or Union type, the "runtime type" will be the actual
 * Object type returned by that field.
 */
/* istanbul ignore next */
function collectFields(exeContext, runtimeType, selectionSet, fields, visitedFragmentNames) {
  for (let i = 0; i < selectionSet.selections.length; i++) {
    const selection = selectionSet.selections[i];
    switch (selection.kind) {
      case Kind.FIELD:
        if (!shouldIncludeNode(exeContext, selection.directives)) {
          continue;
        }
        const name = getFieldEntryKey(selection);
        if (!fields[name]) {
          fields[name] = [];
        }
        fields[name].push(selection);
        break;
      case Kind.INLINE_FRAGMENT:
        if (!shouldIncludeNode(exeContext, selection.directives) || !doesFragmentConditionMatch(exeContext, selection, runtimeType)) {
          continue;
        }
        collectFields(exeContext, runtimeType, selection.selectionSet, fields, visitedFragmentNames);
        break;
      case Kind.FRAGMENT_SPREAD:
        const fragName = selection.name.value;
        if (visitedFragmentNames[fragName] || !shouldIncludeNode(exeContext, selection.directives)) {
          continue;
        }
        visitedFragmentNames[fragName] = true;
        const fragment = exeContext.fragments[fragName];
        if (!fragment || !doesFragmentConditionMatch(exeContext, fragment, runtimeType)) {
          continue;
        }
        collectFields(exeContext, runtimeType, fragment.selectionSet, fields, visitedFragmentNames);
        break;
    }
  }
  return fields;
}

/**
 * Determines if a field should be included based on the @include and @skip
 * directives, where @skip has higher precidence than @include.
 */
/* istanbul ignore next */
function shouldIncludeNode(exeContext, directives) {
  const skipAST = directives && find(directives, directive => directive.name.value === GraphQLSkipDirective.name);
  if (skipAST) {
    const skipIf = getArgumentValues(GraphQLSkipDirective.args, skipAST.arguments, exeContext.variableValues).if;
    if (skipIf === true) {
      return false;
    }
  }

  const includeAST = directives && find(directives, directive => directive.name.value === GraphQLIncludeDirective.name);
  if (includeAST) {
    const skipIf = getArgumentValues(GraphQLIncludeDirective.args, includeAST.arguments, exeContext.variableValues).if;
    if (includeIf === false) {
      return false;
    }
  }

  return true;
}

/**
 * Determines if a fragment is applicable to the given type.
 */
/* istanbul ignore next */
function doesFragmentConditionMatch(exeContext, fragment, type) {
  const typeConditionAST = fragment.typeCondition;
  if (!typeConditionAST) {
    return true;
  }
  const conditionalType = typeFromAST(exeContext.schema, typeConditionAST);
  if (conditionalType === type) {
    return true;
  }
  if (isAbstractType(conditionalType)) {
    const abstractType = conditionalType;
    return exeContext.schema.isPossibleType(abstractType, type);
  }
  return false;
}

/**
 * This function transforms a JS object `{[key: string]: Promise<T>}` into
 * a `Promise<{[key: string]: T}>`
 *
 * This is akin to bluebird's `Promise.props`, but implemented only using
 * `Promise.all` so it will work with any implementation of ES6 promises.
 */
/* istanbul ignore next */
function promiseForObject(object) {
  const keys = Object.keys(object);
  const valuesAndPromises = keys.map(name => object[name]);
  return Promise.all(valuesAndPromises).then(values => values.reduce((resolvedObject, value, i) => {
    resolvedObject[keys[i]] = value;
    return resolvedObject;
  }, Object.create(null)));
}

/**
 * Implements the logic to compute the key of a given field's entry
 */
/* istanbul ignore next */
function getFieldEntryKey(node) {
  return node.alias ? node.alias.value : node.name.value;
}

/**
 * Resolves the field on the given source object. In particular, this
 * figures out the value that the field returns by calling its resolve function,
 * then calls completeValue to complete promises, serialize scalars, or execute
 * the sub-selection-set for objects.
 */
/* istanbul ignore next */
function resolveField(exeContext, parentType, source, fieldASTs, path) {
  const fieldAST = fieldASTs[0];
  const fieldName = fieldAST.name.value;

  const fieldDef = getFieldDef(exeContext.schema, parentType, fieldName);
  if (!fieldDef) {
    return;
  }

  const returnType = fieldDef.type;
  const resolveFn = fieldDef.observe; // this changed
  invariant(resolveFn, '"' + fieldDef.name + '" does not have an observe function')

  // Build a JS object of arguments from the field.arguments AST, using the
  // variables scope to fulfill any variable references.
  // TODO: find a way to memoize, in case this field is within a List type.
  const args = getArgumentValues(fieldDef.args, fieldAST.arguments, exeContext.variableValues);

  // The resolve function's optional third argument is a context value that
  // is provided to every resolve function within an execution. It is commonly
  // used to represent an authenticated user, or request-specific caches.
  const context = exeContext.contextValue;

  // The resolve function's optional fourth argument is a collection of
  // information about the current execution state.
  const info = {
    fieldName,
    fieldASTs,
    returnType,
    parentType,
    path,
    schema: exeContext.schema,
    fragments: exeContext.fragments,
    rootValue: exeContext.rootValue,
    operation: exeContext.operation,
    variableValues: exeContext.variableValues
  };

  // Get the resolve function, regardless of if its result is normal
  // or abrupt (error).
  const result = resolveOrError(resolveFn, source, args, context, info);

  return completeValueCatchingError(exeContext, returnType, fieldASTs, info, path, result);
}

// Isolates the "ReturnOrAbrupt" behavior to not de-opt the `resolveField`
// function. Returns the result of resolveFn or the abrupt-return Error object.
/* istanbul ignore next */
function resolveOrError(resolveFn, source, args, context, info) {
  try {
    return resolveFn(args.input, context, info);
  } catch (error) {
    // Sometimes a non-error is thrown, wrap it as an Error for a
    // consistent interface.
    return error instanceof Error ? error : new Error(error);
  }
}

// This is a small wrapper around completeValue which detects and logs errors
// in the execution context.
/* istanbul ignore next */
function completeValueCatchingError(exeContext, returnType, fieldASTs, info, path, result) {
  // If the field type is non-nullable, then it is resolved without any
  // protection from errors, however it still properly locates the error.
  if (returnType instanceof GraphQLNonNull) {
    return completeValueWithLocatedError(exeContext, returnType, fieldASTs, info, path, result);
  }

  // Otherwise, error protection is applied, logging the error and resolving
  // a null value for this field if one is encountered.
  try {
    const completed = completeValueWithLocatedError(exeContext, returnType, fieldASTs, info, path, result);
    if (isThenable(completed)) {
      // If `completeValueWithLocatedError` returned a rejected promise, log
      // the rejection error and resolve to null.
      // Note: we don't rely on a `catch` method, but we do expect "thenable"
      // to take a second callback for the error case.
      return completed.then(undefined, error => {
        exeContext.errors.push(error);
        return Promise.resolve(null);
      });
    }
    return completed;
  } catch (error) {
    // If `completeValueWithLocatedError` returned abruptly (threw an error),
    // log the error and return null.
    exeContext.errors.push(error);
    return null;
  }
}

// This is a small wrapper around completeValue which annotates errors with
// location information.
/* istanbul ignore next */
function completeValueWithLocatedError(exeContext, returnType, fieldASTs, info, path, result) {
  try {
    const completed = completeValue(exeContext, returnType, fieldASTs, info, path, result);
    if (isThenable(completed)) {
      return completed.catch(error => Promise.reject(locatedError(error, fieldASTs, path)));
    }
    return completed;
  } catch (error) {
    throw locatedError(error, fieldASTs, path);
  }
}

/**
 * Implements the instructions for completeValue as defined in the
 * "Field entries" section of the spec.
 *
 * If the field type is Non-Null, then this recursively completes the value
 * for the inner type. It throws a field error if that completion returns null,
 * as per the "Nullability" section of the spec.
 *
 * If the field type is a List, then this recursively completes the value
 * for the inner type on each item in the list.
 *
 * If the field type is a Scalar or Enum, ensures the completed value is a legal
 * value of the type by calling the `serialize` method of GraphQL type
 * definition.
 *
 * If the field is an abstract type, determine the runtime type of the value
 * and then complete based on that type
 *
 * Otherwise, the field type expects a sub-selection set, and will complete the
 * value by evaluating all sub-selections.
 */
/* istanbul ignore next */
function completeValue(exeContext, returnType, fieldASTs, info, path, result) {
  return result
}

/**
 * Complete a list value by completing each item in the list with the
 * inner type
 */
/* istanbul ignore next */
function completeListValue(exeContext, returnType, fieldASTs, info, path, result) {
  invariant(isCollection(result), `Expected Iterable, but did not find one for field ${ info.parentType.name }.${ info.fieldName }.`);

  // This is specified as a simple map, however we're optimizing the path
  // where the list contains no Promises by avoiding creating another Promise.
  const itemType = returnType.ofType;
  let containsPromise = false;
  const completedResults = [];
  forEach(result, (item, index) => {
    // No need to modify the info object containing the path,
    // since from here on it is not ever accessed by resolver functions.
    const fieldPath = path.concat([index]);
    const completedItem = completeValueCatchingError(exeContext, itemType, fieldASTs, info, fieldPath, item);

    if (!containsPromise && isThenable(completedItem)) {
      containsPromise = true;
    }
    completedResults.push(completedItem);
  });

  return containsPromise ? Promise.all(completedResults) : completedResults;
}

/**
 * Complete a Scalar or Enum by serializing to a valid value, returning
 * null if serialization is not possible.
 */
/* istanbul ignore next */
function completeLeafValue(returnType, result) {
  invariant(returnType.serialize, 'Missing serialize method on type');
  const serializedResult = returnType.serialize(result);
  if (isNullish(serializedResult)) {
    throw new Error(`Expected a value of type "${ String(returnType) }" but ` + `received: ${ String(result) }`);
  }
  return serializedResult;
}

/**
 * Complete a value of an abstract type by determining the runtime object type
 * of that value, then complete the value for that type.
 */
/* istanbul ignore next */
function completeAbstractValue(exeContext, returnType, fieldASTs, info, path, result) {
  const runtimeType = returnType.resolveType ? returnType.resolveType(result, exeContext.contextValue, info) : defaultResolveTypeFn(result, exeContext.contextValue, info, returnType);

  if (!(runtimeType instanceof GraphQLObjectType)) {
    throw new GraphQLError(`Abstract type ${ returnType.name } must resolve to an Object type at ` + `runtime for field ${ info.parentType.name }.${ info.fieldName } with ` + `value "${ String(result) }", received "${ String(runtimeType) }".`, fieldASTs);
  }

  if (!exeContext.schema.isPossibleType(returnType, runtimeType)) {
    throw new GraphQLError(`Runtime Object type "${ runtimeType.name }" is not a possible type ` + `for "${ returnType.name }".`, fieldASTs);
  }

  return completeObjectValue(exeContext, runtimeType, fieldASTs, info, path, result);
}

/**
 * Complete an Object value by executing all sub-selections.
 */
/* istanbul ignore next */
function completeObjectValue(exeContext, returnType, fieldASTs, info, path, result) {
  // If there is an isTypeOf predicate function, call it with the
  // current result. If isTypeOf returns false, then raise an error rather
  // than continuing execution.
  if (returnType.isTypeOf && !returnType.isTypeOf(result, exeContext.contextValue, info)) {
    throw new GraphQLError(`Expected value of type "${ returnType.name }" but got: ${ String(result) }.`, fieldASTs);
  }

  // Collect sub-fields to execute to complete this value.
  let subFieldASTs = Object.create(null);
  const visitedFragmentNames = Object.create(null);
  for (let i = 0; i < fieldASTs.length; i++) {
    const selectionSet = fieldASTs[i].selectionSet;
    if (selectionSet) {
      subFieldASTs = collectFields(exeContext, returnType, selectionSet, subFieldASTs, visitedFragmentNames);
    }
  }

  return executeFields(exeContext, returnType, result, path, subFieldASTs);
}

/**
 * If a resolveType function is not given, then a default resolve behavior is
 * used which tests each possible type for the abstract type by calling
 * isTypeOf for the object being coerced, returning the first type that matches.
 */
/* istanbul ignore next */
function defaultResolveTypeFn(value, context, info, abstractType) {
  const possibleTypes = info.schema.getPossibleTypes(abstractType);
  for (let i = 0; i < possibleTypes.length; i++) {
    const type = possibleTypes[i];
    if (type.isTypeOf && type.isTypeOf(value, context, info)) {
      return type;
    }
  }
}

/**
 * If a resolve function is not given, then a default resolve behavior is used
 * which takes the property of the source object of the same name as the field
 * and returns it as the result, or if it's a function, returns the result
 * of calling that function.
 */
/* istanbul ignore next */
function defaultResolveFn(source, args, context, opts) {
  var fieldName = opts.fieldName
  // ensure source is a value for which property access is acceptable.
  if (typeof source === 'object' || typeof source === 'function') {
    const property = source[fieldName];
    return typeof property === 'function' ? source[fieldName]() : property;
  }
}

/**
 * Checks to see if this object acts like a Promise, i.e. has a "then"
 * function.
 */
/* istanbul ignore next */
function isThenable(value) {
  return typeof value === 'object' && value !== null && typeof value.then === 'function';
}

/**
 * This method looks up the field on the given type defintion.
 * It has special casing for the two introspection fields, __schema
 * and __typename. __typename is special because it can always be
 * queried as a field, even in situations where no other fields
 * are allowed, like on a Union. __schema could get automatically
 * added to the query type, but that would require mutating type
 * definitions, which would cause issues.
 */
/* istanbul ignore next */
function getFieldDef(schema, parentType, fieldName) {
  if (fieldName === SchemaMetaFieldDef.name && schema.getQueryType() === parentType) {
    return SchemaMetaFieldDef;
  } else if (fieldName === TypeMetaFieldDef.name && schema.getQueryType() === parentType) {
    return TypeMetaFieldDef;
  } else if (fieldName === TypeNameMetaFieldDef.name) {
    return TypeNameMetaFieldDef;
  }
  return parentType.getFields()[fieldName];
}
