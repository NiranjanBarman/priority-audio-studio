import React from 'react';

/**
 * @param {object}   props
 * @param {string}   props.title
 * @param {React.ReactNode} [props.actions] — right-aligned buttons/badges
 * @param {string}   [props.subtitle]
 */
export default function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="row" style={{
      justifyContent: 'space-between',
      marginBottom: 16,
      alignItems: 'flex-start'
    }}>
      <div>
        <h1 className="page-title" style={{ marginBottom: subtitle ? 4 : 0 }}>
          {title}
        </h1>
        {subtitle && <div className="small muted">{subtitle}</div>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}