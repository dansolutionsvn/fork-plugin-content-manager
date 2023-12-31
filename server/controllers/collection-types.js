'use strict';

const { setCreatorFields, pipeAsync } = require('@strapi/utils');

const { getService, pickWritableAttributes } = require('../utils');
const { validateBulkDeleteInput } = require('./validation');

const contentTypesByWebsites = [
  "api::post.post",
  // "api::letak.letak",
  "api::career.career",
  "api::event.event"
];
const contentTypesByWebsite = [
  "api::banner.banner"
];
const contentTypesByDomain = [
  "api::category.category",
  "api::career-form.career-form",
  "api::contact-form.contact-form",
  "api::faq.faq",
  "api::page.page",
  "api::tag.tag",
];

const isAuthorizedByWebsite = (websiteContext, roles) => {
  const authMap = {
    "tamdagroup.eu": "tamdagroup.eu",
    "tamdafoods.eu": "tamdafoods.eu",
    "tamdamedia.eu": "tamdamedia.eu",
    "tamdaoc.eu": "tamdaoc.eu"
  }

  const isAdminAuth = !Object.keys(authMap).includes(websiteContext);
  if (isAdminAuth) {
    const userRoles = roles.map(e => e.name);
    return roles.find(e => e.code === "strapi-super-admin") || Object.keys(authMap).every(e => userRoles.includes(e));
  }

  // Multi site authorizations
  return !!Object.keys(authMap).find(e => e === websiteContext);
}

module.exports = {
  async find(ctx) {
    const { userAbility, user } = ctx.state;
    const { model } = ctx.params;
    const { query } = ctx.request;
    console.log('query', query);

    let website = query.websiteContext;
    if (!isAuthorizedByWebsite(website, user.roles)) {
      return ctx.forbidden();
    }

    if (website) {
      const defaultFilter = {'$and': []};
      query.filters = query.filters ?? defaultFilter;

      let customFilter = null;
      if (contentTypesByWebsites.includes(model)) {
        customFilter = {
          "websites": {
            "domain": {
              "$eq": website
            }
          }
        };
      } else if (contentTypesByWebsite.includes(model)) {
        customFilter = {
          "website": {
            "domain": {
              "$eq": website
            }
          }
        };
      } else if(contentTypesByDomain.includes(model)) {
        customFilter = {
          "domain": {
            "$eq": website
          }
        };
      }

      if (customFilter) {
        query.filters["$and"].push(customFilter);
      }
    }

    console.log('modifiedQuery', JSON.stringify(query));
    const { websiteContext, ...customQuery} = query
    const entityManager = getService('entity-manager');
    const permissionChecker = getService('permission-checker').create({ userAbility, model });

    if (permissionChecker.cannot.read()) {
      return ctx.forbidden();
    }

    const permissionQuery = await permissionChecker.sanitizedQuery.read(customQuery);
    const { results, pagination } = await entityManager.findWithRelationCountsPage(
      permissionQuery,
      model
    );

    const sanitizedResults = await Promise.all(
      results.map((result) => permissionChecker.sanitizeOutput(result))
    );

    ctx.body = {
      results: sanitizedResults,
      pagination,
    };
  },

  async findOne(ctx) {
    const { userAbility, user } = ctx.state;
    const { model, id } = ctx.params;

    // console.log('query', query);

    // let website = query.websiteContext;
    // if (!isAuthorizedByWebsite(website, user.roles)) {
    //   return ctx.forbidden();
    // }

    const entityManager = getService('entity-manager');
    const permissionChecker = getService('permission-checker').create({ userAbility, model });

    if (permissionChecker.cannot.read()) {
      return ctx.forbidden();
    }

    const entity = await entityManager.findOneWithCreatorRolesAndCount(id, model);

    if (!entity) {
      return ctx.notFound();
    }

    if (permissionChecker.cannot.read(entity)) {
      return ctx.forbidden();
    }

    ctx.body = await permissionChecker.sanitizeOutput(entity);
  },

  async create(ctx) {
    const { userAbility, user } = ctx.state;
    const { model } = ctx.params;
    const { body } = ctx.request;

    const totalEntries = await strapi.query(model).count();

    const entityManager = getService('entity-manager');
    const permissionChecker = getService('permission-checker').create({ userAbility, model });

    if (permissionChecker.cannot.create()) {
      return ctx.forbidden();
    }

    const pickWritables = pickWritableAttributes({ model });
    const pickPermittedFields = permissionChecker.sanitizeCreateInput;
    const setCreator = setCreatorFields({ user });

    const sanitizeFn = pipeAsync(pickWritables, pickPermittedFields, setCreator);

    const sanitizedBody = await sanitizeFn(body);
    const entity = await entityManager.create(sanitizedBody, model);

    ctx.body = await permissionChecker.sanitizeOutput(entity);

    if (totalEntries === 0) {
      strapi.telemetry.send('didCreateFirstContentTypeEntry', {
        eventProperties: { model },
      });
    }
  },

  async update(ctx) {
    const { userAbility, user } = ctx.state;
    const { id, model } = ctx.params;
    const { body } = ctx.request;

    const entityManager = getService('entity-manager');
    const permissionChecker = getService('permission-checker').create({ userAbility, model });

    if (permissionChecker.cannot.update()) {
      return ctx.forbidden();
    }

    const entity = await entityManager.findOneWithCreatorRoles(id, model);

    if (!entity) {
      return ctx.notFound();
    }

    if (permissionChecker.cannot.update(entity)) {
      return ctx.forbidden();
    }

    const pickWritables = pickWritableAttributes({ model });
    const pickPermittedFields = permissionChecker.sanitizeUpdateInput(entity);
    const setCreator = setCreatorFields({ user, isEdition: true });

    const sanitizeFn = pipeAsync(pickWritables, pickPermittedFields, setCreator);

    const sanitizedBody = await sanitizeFn(body);
    const updatedEntity = await entityManager.update(entity, sanitizedBody, model);

    ctx.body = await permissionChecker.sanitizeOutput(updatedEntity);
  },

  async delete(ctx) {
    const { userAbility } = ctx.state;
    const { id, model } = ctx.params;

    const entityManager = getService('entity-manager');
    const permissionChecker = getService('permission-checker').create({ userAbility, model });

    if (permissionChecker.cannot.delete()) {
      return ctx.forbidden();
    }

    const entity = await entityManager.findOneWithCreatorRoles(id, model);

    if (!entity) {
      return ctx.notFound();
    }

    if (permissionChecker.cannot.delete(entity)) {
      return ctx.forbidden();
    }

    const result = await entityManager.delete(entity, model);

    ctx.body = await permissionChecker.sanitizeOutput(result);
  },

  async publish(ctx) {
    const { userAbility, user } = ctx.state;
    const { id, model } = ctx.params;

    const entityManager = getService('entity-manager');
    const permissionChecker = getService('permission-checker').create({ userAbility, model });

    if (permissionChecker.cannot.publish()) {
      return ctx.forbidden();
    }

    const entity = await entityManager.findOneWithCreatorRoles(id, model);

    if (!entity) {
      return ctx.notFound();
    }

    if (permissionChecker.cannot.publish(entity)) {
      return ctx.forbidden();
    }

    const result = await entityManager.publish(
      entity,
      setCreatorFields({ user, isEdition: true })({}),
      model
    );

    ctx.body = await permissionChecker.sanitizeOutput(result);
  },

  async unpublish(ctx) {
    const { userAbility, user } = ctx.state;
    const { id, model } = ctx.params;

    const entityManager = getService('entity-manager');
    const permissionChecker = getService('permission-checker').create({ userAbility, model });

    if (permissionChecker.cannot.unpublish()) {
      return ctx.forbidden();
    }

    const entity = await entityManager.findOneWithCreatorRoles(id, model);

    if (!entity) {
      return ctx.notFound();
    }

    if (permissionChecker.cannot.unpublish(entity)) {
      return ctx.forbidden();
    }

    const result = await entityManager.unpublish(
      entity,
      setCreatorFields({ user, isEdition: true })({}),
      model
    );

    ctx.body = await permissionChecker.sanitizeOutput(result);
  },

  async bulkDelete(ctx) {
    const { userAbility } = ctx.state;
    const { model } = ctx.params;
    const { query, body } = ctx.request;
    const { ids } = body;

    await validateBulkDeleteInput(body);

    const entityManager = getService('entity-manager');
    const permissionChecker = getService('permission-checker').create({ userAbility, model });

    if (permissionChecker.cannot.delete()) {
      return ctx.forbidden();
    }

    // TODO: fix
    const permissionQuery = await permissionChecker.sanitizedQuery.delete(query);

    const idsWhereClause = { id: { $in: ids } };
    const params = {
      ...permissionQuery,
      filters: {
        $and: [idsWhereClause].concat(permissionQuery.filters || []),
      },
    };

    const { count } = await entityManager.deleteMany(params, model);

    ctx.body = { count };
  },

  async getNumberOfDraftRelations(ctx) {
    const { userAbility } = ctx.state;
    const { model, id } = ctx.params;

    const entityManager = getService('entity-manager');
    const permissionChecker = getService('permission-checker').create({ userAbility, model });

    if (permissionChecker.cannot.read()) {
      return ctx.forbidden();
    }

    const entity = await entityManager.findOneWithCreatorRolesAndCount(id, model);

    if (!entity) {
      return ctx.notFound();
    }

    if (permissionChecker.cannot.read(entity)) {
      return ctx.forbidden();
    }

    const number = await entityManager.getNumberOfDraftRelations(id, model);

    return {
      data: number,
    };
  },
};
