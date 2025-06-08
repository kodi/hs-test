const hubspot = require('@hubspot/api-client');
const { queue } = require('async');
const _ = require('lodash');

const { filterNullValuesFromObject, goal } = require('./utils');
const Domain = require('./Domain');

const hubspotClient = new hubspot.Client({ accessToken: '' });
const propertyPrefix = 'hubspot__';
let expirationDate;

const generateLastModifiedDateFilter = (
  date,
  nowDate,
  propertyName = 'hs_lastmodifieddate'
) => {
  const lastModifiedDateFilter = date
    ? {
        filters: [
          { propertyName, operator: 'GTE', value: `${date.valueOf()}` },
          { propertyName, operator: 'LTE', value: `${nowDate.valueOf()}` },
        ],
      }
    : {};

  return lastModifiedDateFilter;
};

const saveDomain = async (domain) => {
  // disable this for testing purposes
  return;

  domain.markModified('integrations.hubspot.accounts');
  await domain.save();
};

/**
 * Get access token from HubSpot
 */
const refreshAccessToken = async (domain, hubId, tryCount) => {
  const { HUBSPOT_CID, HUBSPOT_CS } = process.env;
  const account = domain.integrations.hubspot.accounts.find(
    (account) => account.hubId === hubId
  );
  const { accessToken, refreshToken } = account;

  return hubspotClient.oauth.tokensApi
    .createToken(
      'refresh_token',
      undefined,
      undefined,
      HUBSPOT_CID,
      HUBSPOT_CS,
      refreshToken
    )
    .then(async (result) => {
      const body = result.body ? result.body : result;

      const newAccessToken = body.accessToken;
      expirationDate = new Date(body.expiresIn * 1000 + new Date().getTime());

      hubspotClient.setAccessToken(newAccessToken);
      if (newAccessToken !== accessToken) {
        account.accessToken = newAccessToken;
      }

      return true;
    });
};

/**
 * Get recently modified companies as 100 companies per page
 */
const processCompanies = async (domain, hubId, q) => {
  const account = domain.integrations.hubspot.accounts.find(
    (account) => account.hubId === hubId
  );
  const lastPulledDate = new Date(account.lastPulledDates.companies);
  const now = new Date();

  let hasMore = true;
  const offsetObject = {};
  const limit = 100;

  while (hasMore) {
    const lastModifiedDate = offsetObject.lastModifiedDate || lastPulledDate;
    const lastModifiedDateFilter = generateLastModifiedDateFilter(
      lastModifiedDate,
      now
    );
    const searchObject = {
      filterGroups: [lastModifiedDateFilter],
      sorts: [{ propertyName: 'hs_lastmodifieddate', direction: 'ASCENDING' }],
      properties: [
        'name',
        'domain',
        'country',
        'industry',
        'description',
        'annualrevenue',
        'numberofemployees',
        'hs_lead_status',
      ],
      limit,
      after: offsetObject.after,
    };

    let searchResult = {};

    let tryCount = 0;
    while (tryCount <= 4) {
      try {
        searchResult = await hubspotClient.crm.companies.searchApi.doSearch(
          searchObject
        );
        break;
      } catch (err) {
        tryCount++;

        if (new Date() > expirationDate)
          await refreshAccessToken(domain, hubId);

        await new Promise((resolve, reject) =>
          setTimeout(resolve, 5000 * Math.pow(2, tryCount))
        );
      }
    }

    if (!searchResult)
      throw new Error('Failed to fetch companies for the 4th time. Aborting.');

    const data = searchResult?.results || [];
    offsetObject.after = parseInt(searchResult?.paging?.next?.after);

    console.log('fetch company batch');

    data.forEach((company) => {
      if (!company.properties) return;

      const actionTemplate = {
        includeInAnalytics: 0,
        companyProperties: {
          company_id: company.id,
          company_domain: company.properties.domain,
          company_industry: company.properties.industry,
        },
      };

      const isCreated =
        !lastPulledDate || new Date(company.createdAt) > lastPulledDate;

      q.push({
        actionName: isCreated ? 'Company Created' : 'Company Updated',
        actionDate:
          new Date(isCreated ? company.createdAt : company.updatedAt) - 2000,
        ...actionTemplate,
      });
    });

    if (!offsetObject?.after) {
      hasMore = false;
      break;
    } else if (offsetObject?.after >= 9900) {
      offsetObject.after = 0;
      offsetObject.lastModifiedDate = new Date(
        data[data.length - 1].updatedAt
      ).valueOf();
    }
  }

  account.lastPulledDates.companies = now;
  await saveDomain(domain);

  return true;
};

/**
 * Get recently modified contacts as 100 contacts per page
 */
const processContacts = async (domain, hubId, q) => {
  const account = domain.integrations.hubspot.accounts.find(
    (account) => account.hubId === hubId
  );
  const lastPulledDate = new Date(account.lastPulledDates.contacts);
  const now = new Date();

  let hasMore = true;
  const offsetObject = {};
  const limit = 100;

  while (hasMore) {
    const lastModifiedDate = offsetObject.lastModifiedDate || lastPulledDate;
    const lastModifiedDateFilter = generateLastModifiedDateFilter(
      lastModifiedDate,
      now,
      'lastmodifieddate'
    );
    const searchObject = {
      filterGroups: [lastModifiedDateFilter],
      sorts: [{ propertyName: 'lastmodifieddate', direction: 'ASCENDING' }],
      properties: [
        'firstname',
        'lastname',
        'jobtitle',
        'email',
        'hubspotscore',
        'hs_lead_status',
        'hs_analytics_source',
        'hs_latest_source',
      ],
      limit,
      after: offsetObject.after,
    };

    let searchResult = {};

    let tryCount = 0;
    while (tryCount <= 4) {
      try {
        searchResult = await hubspotClient.crm.contacts.searchApi.doSearch(
          searchObject
        );
        break;
      } catch (err) {
        tryCount++;
        console.log('error fetching contacts', err);
        if (new Date() > expirationDate)
          await refreshAccessToken(domain, hubId);

        await new Promise((resolve, reject) =>
          setTimeout(resolve, 5000 * Math.pow(2, tryCount))
        );
      }
    }

    if (!searchResult)
      throw new Error('Failed to fetch contacts for the 4th time. Aborting.');

    const data = searchResult.results || [];

    console.log('fetch contact batch');

    offsetObject.after = parseInt(searchResult.paging?.next?.after);
    const contactIds = data.map((contact) => contact.id);

    // contact to company association
    const contactsToAssociate = contactIds;
    const companyAssociationsResults =
      (
        await (
          await hubspotClient.apiRequest({
            method: 'post',
            path: '/crm/v3/associations/CONTACTS/COMPANIES/batch/read',
            body: {
              inputs: contactsToAssociate.map((contactId) => ({
                id: contactId,
              })),
            },
          })
        ).json()
      )?.results || [];

    const companyAssociations = Object.fromEntries(
      companyAssociationsResults
        .map((a) => {
          if (a.from) {
            contactsToAssociate.splice(
              contactsToAssociate.indexOf(a.from.id),
              1
            );
            return [a.from.id, a.to[0].id];
          } else return false;
        })
        .filter((x) => x)
    );

    data.forEach((contact) => {
      if (!contact.properties || !contact.properties.email) return;

      const companyId = companyAssociations[contact.id];

      const isCreated = new Date(contact.createdAt) > lastPulledDate;

      const userProperties = {
        company_id: companyId,
        contact_name: (
          (contact.properties.firstname || '') +
          ' ' +
          (contact.properties.lastname || '')
        ).trim(),
        contact_title: contact.properties.jobtitle,
        contact_source: contact.properties.hs_analytics_source,
        contact_status: contact.properties.hs_lead_status,
        contact_score: parseInt(contact.properties.hubspotscore) || 0,
      };

      const actionTemplate = {
        includeInAnalytics: 0,
        identity: contact.properties.email,
        userProperties: filterNullValuesFromObject(userProperties),
      };

      q.push({
        actionName: isCreated ? 'Contact Created' : 'Contact Updated',
        actionDate: new Date(isCreated ? contact.createdAt : contact.updatedAt),
        ...actionTemplate,
      });
    });

    if (!offsetObject?.after) {
      hasMore = false;
      break;
    } else if (offsetObject?.after >= 9900) {
      offsetObject.after = 0;
      offsetObject.lastModifiedDate = new Date(
        data[data.length - 1].updatedAt
      ).valueOf();
    }
  }

  account.lastPulledDates.contacts = now;
  await saveDomain(domain);

  return true;
};

/**
 * ------------------------------------
 * Get contact by ID
 * ------------------------------------
 * @param domain
 * @param contactId
 * @returns {Promise<{id: string, properties: {[p: string]: string}, createdAt: Date, updatedAt: Date, archived: boolean}>}
 */
const getContactById = async (domain, contactId) => {
  const contact = await hubspotClient.crm.contacts.basicApi.getById(contactId, [
    'firstname',
    'lastname',
    'email',
    'jobtitle',
    'hs_lead_status',
  ]);

  return {
    id: contact.id,
    properties: contact.properties,
    createdAt: contact.createdAt,
    updatedAt: contact.updatedAt,
    archived: contact.archived,
  };
};

const processMeetings = async (domain, hubId, q) => {
  const UniqueContactMap = new Map();

  const account = domain.integrations.hubspot.accounts.find(
    (account) => account.hubId === hubId
  );

  const lastPulledDate = new Date(account.lastPulledDates.meetings);

  const now = new Date();

  let hasMore = true;
  const offsetObject = {};
  const limit = 100;

  while (hasMore) {
    const lastModifiedDate = offsetObject.lastModifiedDate || lastPulledDate;
    const lastModifiedDateFilter = generateLastModifiedDateFilter(
      lastModifiedDate,
      now,
      'hs_lastmodifieddate'
    );
    const searchObject = {
      filterGroups: [lastModifiedDateFilter],
      sorts: [{ propertyName: 'hs_lastmodifieddate', direction: 'ASCENDING' }],
      properties: [
        'hs_meeting_title',
        'hs_meeting_body',
        'hs_meeting_start_time',
        'hs_meeting_end_time',
        'hs_meeting_external_url',
        'hubspot_owner_id',
      ],
      limit,

      after: offsetObject.after,
    };

    let searchResult = {};

    let tryCount = 0;
    while (tryCount <= 4) {
      try {
        searchResult = await hubspotClient.crm.objects.searchApi.doSearch(
          'meetings',
          searchObject
        );

        break;
      } catch (err) {
        tryCount++;
        console.log('error fetching meetings', err);
        if (new Date() > expirationDate)
          await refreshAccessToken(domain, hubId);

        await new Promise((resolve, reject) =>
          setTimeout(resolve, 5000 * Math.pow(2, tryCount))
        );
      }
    }

    if (!searchResult)
      throw new Error('Failed to fetch meetings for the 4th time. Aborting.');

    const data = searchResult.results || [];

    console.log('fetch meeting batch');

    offsetObject.after = parseInt(searchResult.paging?.next?.after);

    const meetingIds = [];
    const meetingActions = [];

    for (const meeting of data) {
      if (!meeting.properties) return;

      meetingIds.push(meeting.id);

      const actionTemplate = {
        includeInAnalytics: 0,
        meetingProperties: {
          contacts: [],
          meeting_id: meeting.id,
          meeting_title: meeting.properties.hs_meeting_title,
          meeting_start_time: meeting.properties.hs_meeting_start_time,
          meeting_end_time: meeting.properties.hs_meeting_end_time,
          meeting_external_url: meeting.properties.hs_meeting_external_url,
        },
      };

      const meetingCreatedDate = new Date(meeting.properties.hs_createdate);
      const meetingLastModifiedDate = new Date(
        meeting.properties.hs_lastmodifieddate
      );

      // we detect if meeting is created or updated if the difference between created and last modified date is less than 2 seconds
      const isCreated =
        meetingCreatedDate.getTime() > meetingLastModifiedDate.getTime() - 2000;

      const action = {
        actionName: isCreated ? 'Meeting Created' : 'Meeting Updated',
        actionDate:
          new Date(isCreated ? meeting.createdAt : meeting.updatedAt) - 2000, // cast to milliseconds, and also be consistent with other actions
        ...actionTemplate,
      };

      meetingActions.push(action);
    }

    try {
      // get meeting associated contacts
      const associatedContactsRequest = await hubspotClient.apiRequest({
        method: 'post',
        path: '/crm/v4/associations/MEETINGS/CONTACTS/batch/read',
        body: {
          inputs: meetingIds.map((meetingId) => ({
            id: meetingId,
          })),
        },
      });

      const associatedContactsResponse = await associatedContactsRequest.json();

      for (const mapping of associatedContactsResponse.results) {
        const meetingId = mapping.from.id;
        for (const contact of mapping.to) {
          if (!contact.toObjectId) continue;

          const contactId = contact.toObjectId;

          // check if contact is already processed
          // speed up processing by caching contacts
          // to avoid multiple API calls for the same contact
          if (!UniqueContactMap.has(contactId)) {
            const contactData = await getContactById(domain, contactId);
            UniqueContactMap.set(contactId, contactData);
          }

          const contactToAdd = UniqueContactMap.get(contactId);

          // fetch action for this meeting, and add contact email to it
          const meetingAction = meetingActions.find(
            (action) => action.meetingProperties.meeting_id === meetingId
          );
          if (!meetingAction) {
            console.log('meeting action not found for meeting', meetingId);
            continue;
          }

          meetingAction.meetingProperties.contacts.push(
            contactToAdd.properties.email
          );
        }
      }

      // simple console log to show meetings and associated contacts
      // meetingActions.forEach((action) => {
      //   console.log('--------------------------');
      //   console.log('Meeting Action:', action.actionName);
      //   console.log('Meeting ID:', action.meetingProperties.meeting_id);
      //   console.log('Meeting Title:', action.meetingProperties.meeting_title);
      //   console.log(JSON.stringify(action.meetingProperties.contacts, null, 2));
      // });

      meetingActions.forEach((action) => {
        q.push(action);
      });
    } catch (err) {
      console.log('error fetching associated contacts', err);
      return;
    }

    if (!offsetObject?.after) {
      hasMore = false;
      break;
    } else if (offsetObject?.after >= 9900) {
      offsetObject.after = 0;
      offsetObject.lastModifiedDate = new Date(
        data[data.length - 1].updatedAt
      ).valueOf();
    }
  }

  account.lastPulledDates.meetings = now;
  await saveDomain(domain);
  return true;
};

const createQueue = (domain, actions) =>
  queue(async (action, callback) => {
    actions.push(action);

    if (actions.length > 2000) {
      console.log('inserting actions to database', {
        apiKey: domain.apiKey,
        count: actions.length,
      });

      const copyOfActions = _.cloneDeep(actions);
      actions.splice(0, actions.length);

      goal(copyOfActions);
    }

    callback();
  }, 100000000);

const drainQueue = async (domain, actions, q) => {
  if (q.length() > 0) await q.drain();

  if (actions.length > 0) {
    goal(actions);
  }

  return true;
};

const pullDataFromHubspot = async () => {
  console.log('start pulling data from HubSpot');

  const domain = await Domain.findOne({});

  for (const account of domain.integrations.hubspot.accounts) {
    console.log('start processing account');

    try {
      await refreshAccessToken(domain, account.hubId);
    } catch (err) {
      console.log(err, {
        apiKey: domain.apiKey,
        metadata: { operation: 'refreshAccessToken' },
      });
    }

    const actions = [];
    const q = createQueue(domain, actions);

    try {
      const startDateContacts = new Date();
      await processContacts(domain, account.hubId, q);
      console.log(
        'process contacts in: ',
        new Date() - startDateContacts,
        'ms'
      );
    } catch (err) {
      console.log(err, {
        apiKey: domain.apiKey,
        metadata: { operation: 'processContacts', hubId: account.hubId },
      });
    }

    try {
      const startDateCompanies = new Date();
      await processCompanies(domain, account.hubId, q);
      console.log(
        'process companies in: ',
        new Date() - startDateCompanies,
        'ms'
      );
    } catch (err) {
      console.log(err, {
        apiKey: domain.apiKey,
        metadata: { operation: 'processCompanies', hubId: account.hubId },
      });
    }

    try {
      const startDateMeetings = new Date();
      await processMeetings(domain, account.hubId, q);
      console.log(
        'process meetings in: ',
        new Date() - startDateMeetings,
        'ms'
      );
    } catch (err) {
      console.log(err, {
        apiKey: domain.apiKey,
        metadata: { operation: 'processMeetings', hubId: account.hubId },
      });
    }

    try {
      await drainQueue(domain, actions, q);
      console.log('drain queue');
    } catch (err) {
      console.log(err, {
        apiKey: domain.apiKey,
        metadata: { operation: 'drainQueue', hubId: account.hubId },
      });
    }

    await saveDomain(domain);

    console.log('finish processing account');
  }

  process.exit();
};

module.exports = pullDataFromHubspot;
